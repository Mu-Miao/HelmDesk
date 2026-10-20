import SwiftUI

struct DiagnosticsView: View {
    let service: ServiceManager

    var body: some View {
        Form {
            Section("执行端") {
                LabeledContent("状态", value: service.status)
                LabeledContent("协议", value: "HelmDesk / 1")
                LabeledContent("版本", value: service.serviceVersion)
                LabeledContent("连接", value: service.dashboardOrigin?.absoluteString ?? "未连接")
                LabeledContent("运行任务", value: service.activeTasks.formatted())
                Text("后台服务独立运行。关窗、退出和切换目录不会终止已有任务。").foregroundStyle(.secondary)
                Button("重新连接") { Task { await service.connect() } }.disabled(service.isConnecting)
                Button("选择启动端口…") { service.choosePort() }.disabled(service.isConnecting)
            }
            Section("数据目录") {
                Text(service.dataDirectory.path).textSelection(.enabled)
                HStack {
                    Button("选择已有目录…") { service.chooseDataDirectory() }.disabled(service.isConnecting)
                    Button("在访达显示") { service.revealDataDirectory() }
                }
                Text("只复用选定目录，不移动或迁移数据库及任务工作区。").foregroundStyle(.secondary)
            }
            Section("应用运行时") {
                LabeledContent("内置 Node", value: service.runtimeAvailable ? "已就绪" : "缺失")
                Text("Mac 本地版 · ad-hoc 签名 · 尚未公证。iOS 与手机配对暂缓。").foregroundStyle(.secondary)
            }
        }.formStyle(.grouped)
    }
}
