import Foundation

struct DesktopModelPreference: Codable, Sendable {
    var agent: String?
    var model: String
    var label: String?
    var reasoningEffort: String?
}
