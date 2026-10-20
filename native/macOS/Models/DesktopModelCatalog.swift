import Foundation

struct DesktopModelCatalog: Decodable, Sendable {
    let options: [Option]
    struct Option: Decodable, Identifiable, Sendable {
        let id: String
        let label: String
        let kind: String
    }
}
