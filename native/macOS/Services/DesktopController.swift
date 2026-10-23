import SwiftUI
import Observation
import UniformTypeIdentifiers

@MainActor @Observable
final class DesktopController {
    let service: ServiceManager
    private(set) var status: DesktopStatus?
    private(set) var diagnostics: DesktopDiagnostics?
    private(set) var backup: DesktopBackup?
    private(set) var models: DesktopModelCatalog?
    private(set) var catalogAgent = ""
    private(set) var isBusy = false
    private(set) var message: String?
    var draftQoderPath = ""
    var draftProjectRoots: [String] = []
    var draftPort = 4317
    var draftAgent = "qoder-cn"
    var draftModel = ""
    var draftEffort = ""
    init(service: ServiceManager) { self.service = service }

    private struct ConfigRequest: Encodable { let configuration: DesktopConfiguration; let expectedRevision: String }
    private struct Saved: Decodable, Sendable { let saved: Bool }
    private struct ValidBackup: Decodable, Sendable { let valid: Bool }
    private struct Name: Encodable { let name: String }
    private struct Agent: Encodable { let agent: String }
    private struct ModelRequest: Encodable { let agent: String; let model: String; let reasoningEffort: String? }

    private func perform(_ operation: () async throws -> Void) async {
        guard !isBusy else { return }
        isBusy = true; message = nil
        defer { isBusy = false }
        do { try await operation() } catch { message = error.localizedDescription }
    }
    private func loadStatus() async throws {
        let result: DesktopStatus = try await service.desktopCall("status")
        status = result
        backup = result.backups?.first
        draftQoderPath = result.configuration.qoderCLI ?? ""
        draftProjectRoots = result.configuration.projectRoots
        draftPort = result.configuration.preferredPort
        service.setPreferredPortForNextLaunch(result.configuration.preferredPort)
    }
    func refresh() async {
        await perform {
            try await loadStatus()
            let preference: DesktopModelPreference = try await service.toolCall("model_preference_get")
            draftAgent = preference.agent ?? "qoder-cn"
            draftModel = preference.model
            draftEffort = preference.reasoningEffort ?? ""
        }
    }
    func diagnose() async {
        await perform { diagnostics = try await service.desktopCall("diagnostics") }
    }
    func saveConfiguration() async {
        await perform {
            guard let status else { throw ServiceError.message("请先刷新当前执行端设置。") }
            let config = DesktopConfiguration(qoderCLI: draftQoderPath.isEmpty ? nil : draftQoderPath, projectRoots: draftProjectRoots, preferredPort: draftPort)
            let _: Saved = try await service.desktopCall("configure", body: JSONEncoder().encode(ConfigRequest(configuration: config, expectedRevision: status.revision)))
            try await loadStatus()
            message = "执行器与项目范围已保存。端口变更需空闲时点击重启；不会重派任务。"
        }
    }
    func createBackup() async {
        await perform {
            let created: DesktopBackup = try await service.desktopCall("backup")
            try await loadStatus()
            backup = created
            message = "一致性备份已创建，任务工作区仍保留在原目录。"
        }
    }
    func selectBackup(_ name: String) { backup = status?.backups?.first { $0.name == name } }
    func verifyBackup() async {
        await perform {
            guard let backup else { return }
            let result: ValidBackup = try await service.desktopCall("verify-backup", body: JSONEncoder().encode(Name(name: backup.name)))
            message = result.valid ? "备份的文件校验、数据库完整性和记录摘要均通过。" : "备份未通过校验。"
        }
    }
    func restartService() async {
        await perform {
            let alert = NSAlert()
            alert.messageText = "重启空闲执行端？"
            alert.informativeText = "其他本机窗口会短暂断连。后台会重新核对任务，不会自动重派；有排队或运行任务时服务会拒绝重启。"
            alert.addButton(withTitle: "重启空闲执行端"); alert.addButton(withTitle: "取消")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            try await service.restartIdleService()
            try await loadStatus()
            message = "执行端已重新连接。"
        }
    }
    func chooseQoder() {
        guard !isBusy else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true; panel.canChooseDirectories = true; panel.allowsMultipleSelection = false
        panel.message = "选择官方 Qoder CN.app，或官方 CLI 文件；不会读取或复制账号配置。"
        guard panel.runModal() == .OK, var url = panel.url else { return }
        if url.pathExtension == "app" { url.append(path: "Contents/Resources/app.asar.unpacked/node_modules/@qoder-ai/qoder-cn-agent-sdk/dist/_worker/qoder-worker-runtime.obf.mjs") }
        draftQoderPath = url.path
    }
    func useAutomaticQoder() { draftQoderPath = "" }
    func addProjectRoot() {
        guard !isBusy else { return }
        let panel = NSOpenPanel(); panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.allowsMultipleSelection = false
        panel.message = "只选择需要派发任务的具体项目目录；保存后才授权新任务使用。"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        if !draftProjectRoots.contains(url.path) { draftProjectRoots.append(url.path) }
    }
    func removeProjectRoot(_ path: String) { draftProjectRoots.removeAll { $0 == path } }
    func showBackupFolder() { NSWorkspace.shared.open(service.dataDirectory.appending(path: "backups")) }
    func exportMCPConfiguration() {
        do {
            guard let runtime = service.runtime, let root = service.serviceRoot else { throw ServiceError.message("内置运行时缺失。") }
            let source = try MCPConfiguration.render(runtime: runtime, entry: root.appending(path: "dist/cli.js"), directory: service.dataDirectory)
            let panel = NSSavePanel(); panel.nameFieldStringValue = "helmdesk-mcp.toml"
            panel.allowedContentTypes = [UTType(filenameExtension: "toml") ?? .plainText]; panel.allowsOtherFileTypes = true
            panel.message = "导出本机 MCP 配置片段；检查后手动合入宿主配置，不会自动覆盖。"
            guard panel.runModal() == .OK, let url = panel.url else { return }
            try Data(source.utf8).write(to: url, options: .atomic)
            message = "MCP 配置已导出。升级时请保持应用安装路径与数据目录不变。"
        } catch { message = error.localizedDescription }
    }
    func loadModels() async {
        await perform {
            let agent = draftAgent
            models = try await service.toolCall("models_list", body: JSONEncoder().encode(Agent(agent: agent)))
            catalogAgent = agent
        }
    }
    func saveModel() async {
        await perform {
            guard catalogAgent == draftAgent, models?.options.contains(where: { $0.id == draftModel }) == true else { throw ServiceError.message("请刷新目录并明确选择可用模型。") }
            let request = ModelRequest(agent: draftAgent, model: draftModel, reasoningEffort: draftAgent == "qoder-cn" && !draftEffort.isEmpty ? draftEffort : nil)
            let saved: DesktopModelPreference = try await service.toolCall("model_preference_set", body: JSONEncoder().encode(request))
            draftEffort = saved.reasoningEffort ?? ""
            message = draftAgent == "antigravity" ? "辅助默认模型已保存；主要执行器保持原设置。" : "默认模型已保存，仅用于后续任务；已有任务保持原设置。"
        }
    }
}
