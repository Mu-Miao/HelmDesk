import Foundation

enum StartupFailure: Error, LocalizedError, Sendable, Equatable {
    case portConflict, databaseIncompatible, permissions, isolation, processCleanup, executor, unknown
    init(log: String) {
        if log.contains("EADDRINUSE") { self = .portConflict }
        else if log.contains("数据库版本") || log.contains("数据库结构") || log.contains("数据库格式") { self = .databaseIncompatible }
        else if log.contains("EACCES") || log.contains("EPERM") { self = .permissions }
        else if log.contains("沙箱") || log.contains("sandbox") { self = .isolation }
        else if log.contains("清理未确认") { self = .processCleanup }
        else if log.contains("CLI") || log.contains("Qoder") { self = .executor }
        else { self = .unknown }
    }
    var errorDescription: String? {
        switch self {
        case .portConflict: "端口已被占用。请到设置选择空闲端口后重试；不会终止占用端口的进程。"
        case .databaseIncompatible: "数据版本或结构不兼容。请使用匹配的应用版本；原数据库已保留，勿覆盖新增记录。"
        case .permissions: "文件夹访问被拒绝，请通过设置重新选择目录并确认 macOS 权限。"
        case .isolation: "执行隔离检查未通过。请检查系统沙箱和工具链，不会无隔离执行。"
        case .processCleanup: "执行进程清理尚未确认，请核实现场；不会凭历史 PID 操作进程。"
        case .executor: "官方 Qoder CLI 不可用。请在设置选择官方应用或 CLI，并通过官方方式登录。"
        case .unknown: "后台服务未能启动。请检查数据目录中的 service.stderr.log 和 native-launch.log。"
        }
    }
}
