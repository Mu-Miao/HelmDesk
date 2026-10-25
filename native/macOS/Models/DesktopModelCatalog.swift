import Foundation

struct DesktopModelCatalog: Decodable, Sendable {
    let options: [Option]
    let agentPreference: DesktopModelPreference?
    struct Option: Decodable, Identifiable, Sendable {
        let id: String
        let label: String
        let kind: String
    }
}
