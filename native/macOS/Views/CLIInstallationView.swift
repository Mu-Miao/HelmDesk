import SwiftUI

@MainActor
struct CLIInstallationView: View {
    @Bindable var controller: CLIInstallationController

    private var running: Bool { controller.snapshot?.isRunning == true }
    private var locked: Bool { controller.isRequesting || running || controller.service.isConnecting }

    var body: some View {
        Form {
            Section("Homebrew") {
                if let brew = controller.snapshot?.homebrew {
                    Label(brew.available ? "已检测到 Homebrew" : "尚未就绪", systemImage: brew.available ? "checkmark.circle" : "shippingbox")
                    if let version = brew.version { Text(version).font(.caption).textSelection(.enabled) }
                    if let path = brew.path { Text(path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    Text(brew.reason).foregroundStyle(.secondary)
                    if !brew.available, brew.supported {
                        Link("前往 Homebrew 官网", destination: URL(string: "https://brew.sh/")!)
                        Text("请按官网说明在终端完成 Homebrew 安装，然后回来点“重新检测”。领航台不会替你安装 Homebrew。")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                } else {
                    Text("检测 Homebrew 和已安装的 CLI…").foregroundStyle(.secondary)
                }
            }
            Section("选择需要安装的 CLI") {
                ForEach(controller.snapshot?.tools ?? []) { tool in
                    VStack(alignment: .leading, spacing: 5) {
                        Toggle(isOn: Binding(get: { controller.selected.contains(tool.id) }, set: { value in
                            if value { controller.selected.insert(tool.id) } else { controller.selected.remove(tool.id) }
                        })) {
                            HStack {
                                Text(tool.label)
                                Spacer()
                                Text(tool.installed ? "已安装\(tool.version.map { " · \($0)" } ?? "")" : "未安装")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .toggleStyle(.checkbox)
                        .accessibilityLabel("选择安装 \(tool.label)")
                        .accessibilityValue(tool.installed ? "已安装" : controller.selected.contains(tool.id) ? "已选择" : "未选择")
                        .disabled(locked || tool.installed || controller.snapshot?.homebrew.available != true)
                        Text(tool.method).font(.caption).foregroundStyle(.secondary)
                        Text(tool.detail).font(.caption).foregroundStyle(.secondary)
                        if let url = URL(string: tool.sourceURL) { Link("安装来源", destination: url).font(.caption) }
                    }.padding(.vertical, 4)
                }
                Text("已安装的 CLI 会保留，不在这里自动升级或覆盖。安装不会登录账号、下载模型或替换默认执行器。")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Section {
                HStack {
                    Button("安装所选 CLI（\(controller.selected.count)）") { Task { await controller.install() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(locked || controller.selected.isEmpty || controller.snapshot?.homebrew.available != true)
                    Button("重新检测") { Task { await controller.refresh() } }.disabled(locked)
                    if running {
                        Button("取消安装", role: .cancel) { Task { await controller.cancel() } }.disabled(controller.isRequesting)
                    }
                    if controller.isRequesting || controller.snapshot?.checking == true { ProgressView().controlSize(.small) }
                }
                if let message = controller.message {
                    Text(message).foregroundStyle(.red).textSelection(.enabled).accessibilityLabel("安装提示 \(message)")
                }
            }
            if let job = controller.snapshot?.job {
                Section("安装进度") {
                    HStack {
                        if running { ProgressView().controlSize(.small) }
                        Text(job.message).textSelection(.enabled)
                    }
                    if let target = job.activeTarget {
                        Text("当前：\(controller.snapshot?.tools.first { $0.id == target }?.label ?? target)").foregroundStyle(.secondary)
                    }
                    if !job.log.isEmpty {
                        ScrollView {
                            Text(job.log).font(.system(.caption, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled).padding(8)
                        }.frame(height: 180).background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
                        .accessibilityLabel("CLI 安装日志")
                    }
                    Text("关闭窗口后安装仍由本机服务继续。失败不会自动重试；取消可能保留已经完成的组件。")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Section {
                Text("安装完成后会重新检测。账号登录、服务启动和模型权限仍需分别确认；Ollama 不会自动启动服务或下载模型。")
                    .font(.callout).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 640, minHeight: 580)
        .task { await controller.refresh() }
        .onChange(of: controller.service.instanceId) { Task { await controller.connectionChanged() } }
    }
}
