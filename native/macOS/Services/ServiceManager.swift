import SwiftUI
import Observation
import OSLog

@MainActor @Observable
final class ServiceManager {
    private(set) var dataDirectory: URL
    private(set) var dashboardURL: URL?
    private(set) var instanceId = ""
    private(set) var status = "正在连接本机执行端…"
    private(set) var errorMessage: String?
    private(set) var isConnecting = false
    private(set) var activeTasks = 0
    private(set) var serviceVersion = "—"
    private(set) var exportMessage: String?
    @ObservationIgnored private var heartbeat: Task<Void, Never>?
    @ObservationIgnored private var launcher: Process?
    @ObservationIgnored private var launchLog: FileHandle?
    @ObservationIgnored private let session = URLSession(configuration: .ephemeral, delegate: RedirectBlocker(), delegateQueue: nil)
    @ObservationIgnored private let logger = Logger(subsystem: "cn.helmdesk.mac", category: "Connection")
    @ObservationIgnored private var wakeObserver: NSObjectProtocol?
    @ObservationIgnored private var sleepObserver: NSObjectProtocol?

    init() {
        let configured = ProcessInfo.processInfo.environment["HELMDESK_DATA_DIR"]
            ?? UserDefaults.standard.string(forKey: "dataDirectory")
        dataDirectory = configured.map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? URL.applicationSupportDirectory.appending(path: "HelmDesk", directoryHint: .isDirectory)
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.connect() }
        }
        sleepObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.heartbeat?.cancel()
                self?.dashboardURL = nil
                self?.status = "Mac 正在休眠，唤醒后重新核对执行端"
                self?.errorMessage = "任务状态尚未确认；唤醒后只检查连接，不自动重派任务。"
            }
        }
    }

    var serviceRoot: URL? { Bundle.main.resourceURL?.appending(path: "service") }
    var runtime: URL? { Bundle.main.resourceURL?.appending(path: "runtime/node") }
    var runtimeAvailable: Bool { runtime.map { FileManager.default.isExecutableFile(atPath: $0.path) } ?? false }
    var dashboardOrigin: URL? {
        guard let dashboardURL, var parts = URLComponents(url: dashboardURL, resolvingAgainstBaseURL: false) else { return nil }
        parts.fragment = nil
        parts.query = nil
        return parts.url
    }

    func connect() async {
        guard !isConnecting else { return }
        logger.notice("connection.checking")
        isConnecting = true
        defer { isConnecting = false }
        heartbeat?.cancel()
        dashboardURL = nil
        errorMessage = nil
        status = "正在核对本机服务身份…"
        do {
            let selectedDirectory = dataDirectory
            dataDirectory = try await Task.detached(priority: .utility) { try Self.prepareDirectory(selectedDirectory) }.value
            if let connection = try await readConnection() {
                do {
                    let identity = try await handshake(connection)
                    try await accept(connection, identity)
                    return
                } catch let error as URLError where error.code == .cannotConnectToHost || error.code == .networkConnectionLost {
                    // The helper checks the live lock and serializes startup. Never kill a recorded PID.
                }
            }
            try await launchHelper()
            for _ in 0..<60 {
                try Task.checkCancellation()
                if let connection = try await readConnection() {
                    do {
                        let identity = try await handshake(connection)
                        try await accept(connection, identity)
                        return
                    } catch let error as URLError where error.code == .cannotConnectToHost || error.code == .networkConnectionLost {
                        // A connection record may appear shortly before listen completes.
                    }
                }
                if let launcher, !launcher.isRunning, launcher.terminationStatus != 0 {
                    let directory = dataDirectory
                    throw await Task.detached(priority: .utility) {
                        var tail = ""
                        for name in ["service.stderr.log", "native-launch.log"] {
                            if let file = try? FileHandle(forReadingFrom: directory.appending(path: name)) {
                                defer { try? file.close() }
                                let length = (try? file.seekToEnd()) ?? 0
                                try? file.seek(toOffset: length > 4096 ? length - 4096 : 0)
                                if let data = try? file.read(upToCount: 4096) { tail += String(decoding: data, as: UTF8.self) }
                            }
                        }
                        return StartupFailure(log: tail)
                    }.value
                }
                try await Task.sleep(for: .milliseconds(200))
            }
            throw ServiceError.message("服务尚未就绪。后台启动不会重复派发任务；请稍后重试或查看数据目录中的服务日志。")
        } catch {
            logger.error("connection.failed type=\(String(reflecting: type(of: error)), privacy: .public) code=\((error as NSError).code)")
            status = "执行端未连接"
            errorMessage = error.localizedDescription
        }
    }

    private nonisolated static func prepareDirectory(_ dataDirectory: URL) throws -> URL {
        let directory = dataDirectory.resolvingSymlinksInPath().standardizedFileURL
        let protected = Set([".codex", ".agents", ".ssh", ".aws", ".qoder", ".qoder-cn", ".qoderworkcn", ".auth", ".models", ".gnupg", ".azure", ".kube", ".docker"])
        guard directory.path != "/", directory != URL.homeDirectory,
              !directory.pathComponents.contains(where: { protected.contains($0.lowercased()) }) else {
            throw ServiceError.message("请选择专用的领航台数据目录，不能使用主目录、系统根目录或凭据目录。")
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return URL(fileURLWithPath: try CanonicalDirectory.path(directory), isDirectory: true)
    }

    private func readConnection() async throws -> ServiceConnection? {
        let directory = dataDirectory
        // A protected Desktop directory may wait for a macOS permission prompt.
        // Keep that blocking file I/O away from the window's main actor.
        return try await Task.detached(priority: .utility) {
            try ConnectionFileReader.read(directory: directory)
        }.value
    }

    private func handshake(_ connection: ServiceConnection) async throws -> ServiceIdentity {
        var request = URLRequest(url: connection.origin.appending(path: "api/runtime"))
        request.timeoutInterval = 2
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200, response.url == request.url else {
            throw ServiceError.message("本机服务拒绝身份校验。请核对连接目录和服务版本。")
        }
        let identity = try JSONDecoder().decode(ServiceIdentity.self, from: data)
        try identity.validate(connection: connection)
        return identity
    }

    private func launchHelper() async throws {
        if launcher?.isRunning == true { return }
        guard let runtime, let serviceRoot, runtimeAvailable else {
            throw ServiceError.message("应用内置运行时缺失，请使用项目构建入口重新打包。")
        }
        try launchLog?.close()
        let logURL = dataDirectory.appending(path: "native-launch.log")
        let log = try await Task.detached(priority: .utility) {
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            }
            let log = try FileHandle(forWritingTo: logURL)
            try log.seekToEnd()
            return log
        }.value
        let process = Process()
        process.executableURL = runtime
        process.arguments = [serviceRoot.appending(path: "dist/cli.js").path, "app-service", "--data-dir", dataDirectory.path]
        let preferred = UserDefaults.standard.integer(forKey: "servicePort." + dataDirectory.path)
        if (1024...65535).contains(preferred) { process.arguments?.append(contentsOf: ["--port", String(preferred)]) }
        process.currentDirectoryURL = serviceRoot
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = [runtime.deletingLastPathComponent().path, "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", environment["PATH"] ?? ""].joined(separator: ":")
        environment["HELMDESK_PROJECT_ROOTS"] = environment["HELMDESK_PROJECT_ROOTS"] ?? dataDirectory.path
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = log
        process.standardError = log
        try process.run()
        launcher = process
        launchLog = log
    }

    private func browserEntry(_ connection: ServiceConnection) async throws -> URL {
        var request = URLRequest(url: connection.origin.appending(path: "api/browser-ticket"))
        request.httpMethod = "POST"
        request.httpBody = Data("{}".utf8)
        request.timeoutInterval = 5
        request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              response.url == request.url, data.count <= 4096 else {
            throw ServiceError.message("服务不支持安全网页入口，请在任务结束后重启新版后台。")
        }
        return try JSONDecoder().decode(BrowserEntry.self, from: data).url(for: connection)
    }

    private func accept(_ connection: ServiceConnection, _ identity: ServiceIdentity) async throws {
        let entry = try await browserEntry(connection)
        logger.notice("connection.verified protocol=\(identity.protocolVersion) active=\(identity.activeTasks)")
        UserDefaults.standard.set(dataDirectory.path, forKey: "dataDirectory")
        dashboardURL = entry
        instanceId = connection.instanceId
        activeTasks = identity.activeTasks
        serviceVersion = identity.version
        status = "本机服务已连接 · 后台任务独立运行"
        heartbeat = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(5))
                    guard let self else { return }
                    guard let current = try await self.readConnection() else { throw ServiceError.message("本机服务已退出") }
                    let identity = try await self.handshake(current)
                    guard current.instanceId == self.instanceId else { throw ServiceError.message("后台服务实例已变化，请重新连接") }
                    self.activeTasks = identity.activeTasks
                } catch is CancellationError { return }
                catch {
                    guard let self else { return }
                    self.dashboardURL = nil
                    self.logger.error("connection.lost")
                    self.status = "执行端连接已中断"
                    self.errorMessage = "请核对后台服务后重连。不会自动重派模型任务。"
                    return
                }
            }
        }
    }

    func webViewFailed(_ message: String) {
        heartbeat?.cancel()
        errorMessage = message
        dashboardURL = nil
    }

    func recordExport(_ message: String) { exportMessage = message }

    func setPreferredPortForNextLaunch(_ port: Int) {
        if (1024...65535).contains(port) { UserDefaults.standard.set(port, forKey: "servicePort." + dataDirectory.path) }
    }

    func choosePort() {
        guard !isConnecting else { return }
        let alert = NSAlert()
        alert.messageText = "选择当前数据目录的启动端口"
        alert.informativeText = "输入 1024–65535 的空闲端口。仅用于启动；已有服务仍先核对身份，不会终止占用端口的进程。"
        let input = NSTextField(string: "4318")
        input.frame = NSRect(x: 0, y: 0, width: 240, height: 24)
        input.setAccessibilityLabel("新启动端口")
        alert.accessoryView = input
        alert.addButton(withTitle: "使用此端口重连"); alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        guard let port = Int(input.stringValue), (1024...65535).contains(port) else {
            errorMessage = "端口必须是 1024–65535 的整数。"; return
        }
        setPreferredPortForNextLaunch(port)
        Task { await connect() }
    }

    func desktopCall<Response: Decodable & Sendable>(_ action: String, body: Data = Data("{}".utf8)) async throws -> Response {
        try await authenticatedCall("api/desktop/\(action)", body: body)
    }

    func toolCall<Response: Decodable & Sendable>(_ name: String, body: Data = Data("{}".utf8)) async throws -> Response {
        try await authenticatedCall("api/tool/\(name)", body: body)
    }

    func toolData(_ name: String, body: Data) async throws -> Data { try await authenticatedData("api/tool/\(name)", body: body) }

    private func authenticatedCall<Response: Decodable & Sendable>(_ path: String, body: Data) async throws -> Response {
        try JSONDecoder().decode(Response.self, from: await authenticatedData(path, body: body))
    }

    private func authenticatedData(_ path: String, body: Data) async throws -> Data {
        guard dashboardURL != nil, let connection = try await readConnection(), connection.instanceId == instanceId else {
            throw ServiceError.message("执行端连接已变化，请重新连接后操作。")
        }
        _ = try await handshake(connection)
        var request = URLRequest(url: connection.origin.appending(path: path))
        request.httpMethod = "POST"
        request.httpBody = body
        request.timeoutInterval = 65
        request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.url == request.url else { throw ServiceError.message("执行端响应来源不符。") }
        guard response.statusCode == 200 else {
            if response.statusCode == 404 { throw ServiceError.message("已有服务版本不支持原生管理，请在任务结束后重启新版后台。") }
            throw ServiceError.message((try? JSONDecoder().decode(ServiceResponseError.self, from: data).error) ?? "执行端未完成操作，请刷新后核对状态。")
        }
        guard connection.instanceId == instanceId else { throw ServiceError.message("操作期间连接已切换，请刷新后核对结果。") }
        guard data.count <= 20 * 1024 * 1024 else { throw ServiceError.message("响应超过原生界面的 20 MB 限制，请在看板缩小所选范围。") }
        return data
    }

    func restartIdleService() async throws {
        struct Reply: Decodable, Sendable { let stopping: Bool }
        let reply: Reply = try await desktopCall("stop")
        guard reply.stopping else { throw ServiceError.message("执行端未确认停止。") }
        heartbeat?.cancel()
        dashboardURL = nil
        for _ in 0..<30 {
            if try await readConnection() == nil { await connect(); return }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw ServiceError.message("服务仍在停止，请稍后重连；不会终止未确认的进程。")
    }

    func revealDataDirectory() { NSWorkspace.shared.open(dataDirectory) }
    func openInBrowser() {
        Task {
            do {
                guard dashboardURL != nil, let connection = try await readConnection(), connection.instanceId == instanceId else {
                    throw ServiceError.message("请先重新连接执行端。")
                }
                _ = try await handshake(connection)
                let url = try await browserEntry(connection)
                guard connection.instanceId == instanceId else { throw ServiceError.message("连接已变化，请重新打开。") }
                NSWorkspace.shared.open(url)
            } catch { errorMessage = error.localizedDescription }
        }
    }

    func chooseDataDirectory() {
        guard !isConnecting else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.message = "选择已有领航台数据目录；应用不会移动或迁移其中的数据。"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        dataDirectory = url.resolvingSymlinksInPath()
        UserDefaults.standard.set(dataDirectory.path, forKey: "dataDirectory")
        Task { await connect() }
    }
}
