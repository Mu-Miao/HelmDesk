import Foundation

struct ServiceConnection: Decodable, Sendable {
    let service: String
    let protocolVersion: Int
    let instanceId: String
    let dataDirectory: String
    let port: Int
    let pid: Int
    let token: String

    var origin: URL { URL(string: "http://127.0.0.1:\(port)")! }

    func validate(directory: URL) throws {
        guard service == "helmdesk", protocolVersion == 1,
              UUID(uuidString: instanceId) != nil,
              dataDirectory == (try CanonicalDirectory.path(directory)),
              (1024...65535).contains(port), pid > 1,
              token.count == 64, token.allSatisfy({ $0.isHexDigit }) else {
            throw ServiceError.message("连接记录不支持当前协议或数据目录。请在任务结束后手动重启旧版服务。")
        }
    }
}

struct ServiceIdentity: Decodable, Sendable {
    let service: String
    let protocolVersion: Int
    let instanceId: String
    let dataDirectory: String
    let port: Int
    let version: String
    let activeTasks: Int

    func validate(connection: ServiceConnection) throws {
        guard service == connection.service, protocolVersion == connection.protocolVersion,
              instanceId == connection.instanceId, dataDirectory == connection.dataDirectory,
              port == connection.port, activeTasks >= 0 else {
            throw ServiceError.message("后台服务身份与本机连接记录不一致，已阻止加载。")
        }
    }
}

enum ServiceError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case let .message(text) = self { text } else { nil } }
}
