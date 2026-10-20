import Foundation

struct BrowserEntry: Decodable, Sendable {
    let ticket: String
    let expiresAt: String
    let instanceId: String

    func url(for connection: ServiceConnection) throws -> URL {
        guard instanceId == connection.instanceId, ticket.utf8.count == 64,
              ticket.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            throw ServiceError.message("网页入口与已确认的服务身份不符，请重新连接。")
        }
        var components = URLComponents(url: connection.origin, resolvingAgainstBaseURL: false)!
        components.fragment = "helmdesk-ticket=" + ticket
        guard let url = components.url else { throw ServiceError.message("无法建立网页入口。") }
        return url
    }
}
