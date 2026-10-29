import SwiftUI

struct ContentView: View {
    let service: ServiceManager
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(spacing: 0) {
            if let url = service.dashboardURL {
                DeskWebView(url: url, onError: service.webViewFailed, onExport: service.recordExport,
                            onInstall: { openWindow(id: "cli-installer") }).id(service.instanceId)
            } else if service.isConnecting {
                VStack(spacing: 16) {
                    ProgressView()
                    Text(service.status).foregroundStyle(.secondary)
                    Text("首次连接已有数据目录时，请确认 macOS 的文件夹访问提示。")
                        .font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView {
                    Label("执行端尚未连接", systemImage: "network.slash")
                } description: {
                    Text(service.errorMessage ?? "请连接本机领航台执行端。")
                } actions: {
                    Button("重新连接") { Task { await service.connect() } }.buttonStyle(.borderedProminent)
                    Button("选择其他启动端口…") { service.choosePort() }
                    Button("选择已有数据目录") { service.chooseDataDirectory() }
                    Button("显示数据目录") { service.revealDataDirectory() }
                }
            }
            Divider()
            HStack(spacing: 12) {
                Image(systemName: service.dashboardURL == nil ? "circle" : "checkmark.circle.fill")
                    .foregroundStyle(service.dashboardURL == nil ? Color.secondary : Color.green)
                    .accessibilityHidden(true)
                Text(service.status)
                Spacer()
                if let message = service.exportMessage { Text(message).lineLimit(1).help(message) }
                if service.dashboardURL != nil {
                    Text("执行中 \(service.activeTasks)").monospacedDigit()
                    Button("浏览器") { service.openInBrowser() }
                }
                SettingsLink { Label("服务诊断", systemImage: "gearshape") }
                Button("CLI 安装") { openWindow(id: "cli-installer") }
            }.font(.caption).padding(.horizontal, 14).padding(.vertical, 9)
        }
    }
}
