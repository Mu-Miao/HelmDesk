import Foundation

struct DesktopDiagnostics: Decodable, Sendable {
    let sampledAt: String
    let inferenceRequested: Bool
    let checks: [Check]

    struct Check: Decodable, Identifiable, Sendable {
        let id: String
        let title: String
        let status: String
        let detail: String
    }
}
