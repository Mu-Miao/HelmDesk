import SwiftUI
import OSLog

@main
struct HelmDeskApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var service: ServiceManager
    @State private var desktop: DesktopController
    @Environment(\.openWindow) private var openWindow

    init() {
        let manager = ServiceManager()
        _service = State(initialValue: manager)
        _desktop = State(initialValue: DesktopController(service: manager))
    }

    var body: some Scene {
        WindowGroup("领航台 · HelmDesk", id: "main") {
            ContentView(service: service)
                .frame(minWidth: 860, minHeight: 620)
                .task { if service.dashboardURL == nil { await service.connect() } }
                .onAppear { delegate.reopen = { openWindow(id: "main") } }
        }
        .defaultSize(width: 1240, height: 820)
        .commands {
            CommandGroup(after: .importExport) {
                Button("导出任务报告…") { openWindow(id: "reports") }.disabled(service.dashboardURL == nil)
            }
            CommandGroup(after: .windowArrangement) {
                Button("打开领航台") { openWindow(id: "main") }
                    .keyboardShortcut("0", modifiers: [.command])
            }
            CommandMenu("执行端") {
                Button("重新连接") { Task { await service.connect() } }.disabled(service.isConnecting)
                Button("显示数据目录") { service.revealDataDirectory() }
                Button("在浏览器打开") { service.openInBrowser() }.disabled(service.dashboardURL == nil)
            }
        }
        Settings {
            TabView {
                DiagnosticsView(service: service).tabItem { Label("连接", systemImage: "network") }
                DesktopSettingsView(controller: desktop).tabItem { Label("执行与数据", systemImage: "gearshape") }
            }
            .frame(width: 740, height: 720)
            .task { await desktop.refresh() }
            .onChange(of: service.instanceId) { Task { await desktop.refresh() } }
        }
        Window("导出任务报告", id: "reports") { ReportExportView(service: service) }.defaultSize(width: 640, height: 500)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    var reopen: (() -> Void)?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Logger(subsystem: "cn.helmdesk.mac", category: "Windowing").notice("application.launched")
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { reopen?() }
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let alert = NSAlert()
        alert.messageText = "退出领航台界面？"
        alert.informativeText = "后台执行端和进行中的任务会继续运行。重新打开应用可连接原有服务。"
        alert.addButton(withTitle: "退出界面")
        alert.addButton(withTitle: "取消")
        return alert.runModal() == .alertFirstButtonReturn ? .terminateNow : .terminateCancel
    }
}
