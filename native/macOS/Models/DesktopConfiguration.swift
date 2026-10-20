import Foundation

struct DesktopConfiguration: Codable, Sendable {
    var qoderCLI: String?
    var projectRoots: [String]
    var preferredPort: Int
    enum CodingKeys: String, CodingKey { case qoderCLI, projectRoots, preferredPort }
    func encode(to encoder: any Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(qoderCLI, forKey: .qoderCLI)
        try values.encode(projectRoots, forKey: .projectRoots)
        try values.encode(preferredPort, forKey: .preferredPort)
    }
}
