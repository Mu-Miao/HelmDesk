import Foundation

struct DesktopStatus: Decodable, Sendable {
    let configuration: DesktopConfiguration
    let applied: DesktopConfiguration
    let revision: String
    let restartRequired: Bool
    let data: DataSummary
    let backups: [DesktopBackup]?

    struct DataSummary: Decodable, Sendable {
        let schemaVersion: Int
        let tasks: Int
        let events: Int
        let missingWorkspaces: Int
        let recordDigest: String
        let dataDirectory: String
    }
}
