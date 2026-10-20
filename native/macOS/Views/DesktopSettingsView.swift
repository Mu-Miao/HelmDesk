import SwiftUI

@MainActor
struct DesktopSettingsView: View {
    @Bindable var controller: DesktopController

    private var locked: Bool { controller.isBusy || controller.service.isConnecting }

    var body: some View {
        Form {
            messageSection
            executorSection
            projectRootsSection
            portSection
            dataSection
            modelSection
            diagnosticsSection
            mcpSection
            Section { Button("刷新设置") { Task { await controller.refresh() } }.disabled(locked) }
        }.formStyle(.grouped).frame(minWidth: 640, minHeight: 600)
    }

    private var messageSection: some View {
        Group {
            if locked {
                Section {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text(controller.service.status).foregroundStyle(.secondary)
                    }
                }
            }
            if let message = controller.message {
                Section("提示") {
                    Text(message)
                        .textSelection(.enabled)
                        .accessibilityLabel("提示信息 \(message)")
                }
            }
        }
    }

    private var executorSection: some View {
        Section("执行端") {
            LabeledContent("状态", value: controller.service.status)
            LabeledContent("数据目录") {
                Text(controller.service.dataDirectory.path).textSelection(.enabled)
            }
            LabeledContent("执行端路径") {
                Text(controller.draftQoderPath.isEmpty ? "自动探测" : controller.draftQoderPath)
                    .textSelection(.enabled)
            }
            HStack {
                Button("选择执行端…") { controller.chooseQoder() }.disabled(locked)
                Button("使用自动探测") { controller.useAutomaticQoder() }.disabled(locked)
            }
            Text("留空表示由桌面端自动探测执行端，不写入固定路径。").foregroundStyle(.secondary)
        }
    }

    private var projectRootsSection: some View {
        Section("项目根目录") {
            ForEach(controller.draftProjectRoots, id: \.self) { path in
                HStack {
                    Text(path).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Button("移除") { controller.removeProjectRoot(path) }
                        .buttonStyle(.borderless).disabled(locked)
                }
            }
            Button("添加目录…") { controller.addProjectRoot() }.disabled(locked)
            Text("保存配置后仅对之后新建的任务授权，已有任务的范围不变。").foregroundStyle(.secondary)
        }
    }

    private var portSection: some View {
        Section("端口") {
            TextField("首选端口", value: $controller.draftPort, format: .number)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 160)
                .disabled(locked)
            Text("可用范围 1024–65535。").foregroundStyle(.secondary)
            HStack {
                Button("保存配置") { Task { await controller.saveConfiguration() } }.disabled(locked || controller.status == nil || controller.draftProjectRoots.isEmpty || !(1024...65535).contains(controller.draftPort))
                Button("重启空闲服务") { Task { await controller.restartService() } }
                    .disabled(locked || controller.service.activeTasks > 0)
            }
            Text("服务端在有排队或运行中的任务时会拒绝重启。").foregroundStyle(.secondary)
            if controller.status?.restartRequired == true {
                Label("配置已改动，需要重启服务后生效。", systemImage: "arrow.clockwise")
                    .foregroundStyle(.orange)
            }
        }
    }

    private var dataSection: some View {
        Section("数据完整性") {
            if let status = controller.status {
                LabeledContent("数据版本", value: status.data.schemaVersion.formatted())
                LabeledContent("任务记录", value: status.data.tasks.formatted())
                LabeledContent("事件记录", value: status.data.events.formatted())
                LabeledContent("缺失工作区", value: status.data.missingWorkspaces.formatted())
                if status.data.missingWorkspaces > 0 {
                    Label("有任务工作区缺失，相关任务无法继续执行。", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
                LabeledContent("记录摘要") {
                    Text(status.data.recordDigest).textSelection(.enabled).lineLimit(2)
                }
            } else {
                Text("尚未读取数据状态。").foregroundStyle(.secondary)
            }
            if let backup = controller.backup {
                LabeledContent("最近备份", value: backup.name)
                LabeledContent("备份任务", value: backup.tasks.formatted())
                LabeledContent("备份事件", value: backup.events.formatted())
                LabeledContent("备份缺失工作区", value: backup.missingWorkspaces.formatted())
                LabeledContent("SHA256") {
                    Text(backup.sha256).textSelection(.enabled).lineLimit(2)
                }
            }
            if let backups = controller.status?.backups, backups.count > 1 {
                Menu("选择备份（最近 20 份）") {
                    ForEach(backups, id: \.name) { item in
                        Button(item.name) { controller.selectBackup(item.name) }
                    }
                }.disabled(locked)
            }
            HStack {
                Button("创建一致性备份") { Task { await controller.createBackup() } }.disabled(locked)
                Button("校验最近备份") { Task { await controller.verifyBackup() } }.disabled(locked || controller.backup == nil)
                Button("打开备份目录") { controller.showBackupFolder() }
            }
            Text("备份为一致性 SQLite 副本，任务工作区保持原样，不做移动或改写。").foregroundStyle(.secondary)
        }
    }

    private var modelSection: some View {
        Section("模型默认值") {
            Picker("执行器", selection: $controller.draftAgent) {
                Text("Qoder CN").tag("qoder-cn")
                Text("Ollama").tag("ollama")
            }
            .pickerStyle(.segmented)
            .disabled(locked)
            HStack {
                Picker("模型", selection: $controller.draftModel) {
                    ForEach(modelChoices, id: \.id) { choice in
                        Text(modelLabel(choice)).tag(choice.id)
                    }
                }
                .disabled(locked)
                Button("刷新模型目录") { Task { await controller.loadModels() } }.disabled(locked)
            }
            Picker("思考深度", selection: $controller.draftEffort) {
                Text("默认").tag("")
                if effortEditable {
                    Text("低").tag("low")
                    Text("中").tag("medium")
                    Text("极高").tag("xhigh")
                }
            }
            .disabled(locked)
            .onChange(of: controller.draftModel) { _, _ in
                if !effortEditable { controller.draftEffort = "" }
            }
            HStack {
                Button("保存模型默认值") { Task { await controller.saveModel() } }
                    .disabled(locked || !canSaveModel)
                if controller.models != nil && !canSaveModel {
                    Text("当前模型不在所选代理的目录中。").foregroundStyle(.secondary)
                }
            }
            Text("保存的默认值只影响之后新建的任务，已有任务保留各自模型。").foregroundStyle(.secondary)
        }
    }

    private var modelChoices: [(id: String, label: String, kind: String)] {
        var choices = (controller.models?.options ?? []).map { (id: $0.id, label: $0.label, kind: $0.kind) }
        let draft = controller.draftModel
        if !choices.contains(where: { $0.id == draft }) {
            choices.append((id: draft, label: draft.isEmpty ? "未选择模型" : draft, kind: "missing"))
        }
        return choices
    }

    private func modelLabel(_ choice: (id: String, label: String, kind: String)) -> String {
        switch choice.kind {
        case "custom": return "\(choice.label)（自定义）"
        case "platform": return "\(choice.label)（平台）"
        default: return "\(choice.label)（当前缺失）"
        }
    }

    private var effortEditable: Bool {
        controller.draftAgent == "qoder-cn" && controller.draftModel == "Qwen3.8-Flash"
    }

    private var canSaveModel: Bool {
        guard let options = controller.models?.options else { return false }
        return options.contains { $0.id == controller.draftModel } && controller.catalogAgent == controller.draftAgent
    }

    private var diagnosticsSection: some View {
        Section("诊断") {
            Button("运行诊断") { Task { await controller.diagnose() } }.disabled(locked)
            if let diagnostics = controller.diagnostics {
                ForEach(diagnostics.checks) { check in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: statusIcon(check.status)).foregroundStyle(statusColor(check.status))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(check.title)：\(statusText(check.status))")
                            Text(check.detail).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                            Text("采样时间 \(diagnostics.sampledAt)").font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
                Text("诊断只汇报读取到的事实，不做推断。").foregroundStyle(.secondary)
            } else {
                Text("尚未运行诊断。").foregroundStyle(.secondary)
            }
        }
    }

    private func statusText(_ status: String) -> String {
        switch status {
        case "passed": return "通过"
        case "failed": return "未通过"
        default: return "待确认"
        }
    }

    private func statusIcon(_ status: String) -> String {
        switch status {
        case "passed": return "checkmark.circle.fill"
        case "failed": return "xmark.octagon.fill"
        default: return "questionmark.circle"
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "passed": return .green
        case "failed": return .red
        default: return .yellow
        }
    }

    private var mcpSection: some View {
        Section("MCP") {
            Button("导出 MCP 配置片段") { controller.exportMCPConfiguration() }
            Text("仅导出配置片段供你自行粘贴，桌面端不会自动注册 MCP 服务。").foregroundStyle(.secondary)
        }
    }
}
