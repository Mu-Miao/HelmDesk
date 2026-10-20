import Foundation

struct DesktopBackup: Decodable, Sendable {
    let name: String
    let sha256: String
    let tasks: Int
    let events: Int
    let missingWorkspaces: Int
}
