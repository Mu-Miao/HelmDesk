import SwiftUI
import UniformTypeIdentifiers

struct ReportExportView: View {
    let service: ServiceManager
    @State private var page: ReportTaskPage?
    @State private var selected: String?
    @State private var busy = false
    @State private var message: String?
    private struct PageRequest: Encodable { let limit = 25; let cursor: String? }
    private struct TaskRequest: Encodable { let taskId: String }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("选择一条任务记录导出。报告保留执行、验证、验收和失败事实；补丁仍请在看板完成预检后导出。")
                .foregroundStyle(.secondary)
            List(selection: $selected) {
                ForEach(page?.items ?? []) { task in
                    VStack(alignment: .leading) {
                        Text(task.title)
                        Text("执行：\(task.stateLabel) · 验收：\(task.acceptanceLabel)").font(.caption).foregroundStyle(.secondary)
                    }.tag(task.id)
                }
            }.accessibilityLabel("待导出的任务记录")
            if let message { Text(message).textSelection(.enabled) }
            HStack {
                Button("刷新") { Task { await load() } }
                if let cursor = page?.nextCursor { Button("下一页") { Task { await load(cursor: cursor) } } }
                Text("共 \(page?.total ?? 0) 条").foregroundStyle(.secondary)
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button("Markdown…") { Task { await export(json: false) } }.disabled(selected == nil)
                Button("JSON…") { Task { await export(json: true) } }.disabled(selected == nil)
            }.disabled(busy || service.dashboardURL == nil)
        }.padding(20).frame(minWidth: 560, minHeight: 400)
        .task { await load() }
        .onChange(of: service.instanceId) { Task { await load() } }
    }

    private func load(cursor: String? = nil) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do {
            page = try await service.toolCall("task_briefs_list", body: JSONEncoder().encode(PageRequest(cursor: cursor)))
            selected = nil; message = nil
        } catch { message = error.localizedDescription }
    }

    private func export(json: Bool) async {
        guard !busy, let selected else { return }
        busy = true; defer { busy = false }
        do {
            let response = try await service.toolData("task_export", body: JSONEncoder().encode(TaskRequest(taskId: selected)))
            guard let report = try JSONSerialization.jsonObject(with: response) as? [String: Any],
                  let stem = report["filename"] as? String, let markdown = report["markdown"] as? String,
                  let schemaVersion = report["schemaVersion"], let record = report["record"], let limitations = report["limitations"] else {
                throw ServiceError.message("报告格式不受支持。")
            }
            let suffix = json ? "json" : "md"
            guard let name = ExportPolicy.filename("\((stem as NSString).deletingPathExtension).\(suffix)") else { throw ServiceError.message("报告文件名无效。") }
            let bytes = json ? try JSONSerialization.data(withJSONObject: ["schemaVersion": schemaVersion, "record": record, "limitations": limitations], options: [.prettyPrinted, .sortedKeys]) : Data(markdown.utf8)
            guard bytes.count <= ExportPolicy.maximumBytes else { throw ServiceError.message("报告超过 20 MB，请缩小范围。") }
            let panel = NSSavePanel(); panel.nameFieldStringValue = name
            panel.allowedContentTypes = [UTType(filenameExtension: suffix) ?? .plainText]
            panel.message = "报告可能包含项目内容，请选择保存位置。"
            guard panel.runModal() == .OK, let url = panel.url else { message = "已取消导出"; return }
            try bytes.write(to: url, options: .atomic)
            message = "报告已保存"
        } catch { message = error.localizedDescription }
    }
}
