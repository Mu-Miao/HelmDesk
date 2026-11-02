import Foundation

struct CLIInstallationSnapshot: Decodable, Sendable {
    struct Homebrew: Decodable, Sendable {
        let supported: Bool
        let available: Bool
        let path: String?
        let version: String?
        let reason: String
    }

    struct Tool: Decodable, Sendable, Identifiable {
        let id: String
        let label: String
        let installed: Bool
        let version: String?
        let method: String
        let sourceURL: String
        let detail: String
    }

    struct Job: Decodable, Sendable {
        let id: String
        let state: String
        let targets: [String]
        let activeTarget: String?
        let completedTargets: [String]
        let message: String
        let log: String
        let startedAt: String
        let finishedAt: String?
    }

    let checking: Bool
    let homebrew: Homebrew
    let tools: [Tool]
    let job: Job?

    var isRunning: Bool { job?.state == "running" }
}

enum InstallerNavigationPolicy {
    static func allows(_ target: URL, sourceOrigin: URL, expectedOrigin: URL,
                       mainFrame: Bool, linkActivated: Bool) -> Bool {
        allows(target, sourceScheme: sourceOrigin.scheme ?? "", sourceHost: sourceOrigin.host ?? "",
               sourcePort: sourceOrigin.port ?? 0, expectedOrigin: expectedOrigin, mainFrame: mainFrame, linkActivated: linkActivated)
    }

    static func allows(_ target: URL, sourceScheme: String, sourceHost: String, sourcePort: Int,
                       expectedOrigin: URL, mainFrame: Bool, linkActivated: Bool) -> Bool {
        mainFrame && linkActivated && sourceScheme == expectedOrigin.scheme &&
        sourceHost == expectedOrigin.host && sourcePort == (expectedOrigin.port ?? 0) &&
        target.scheme == "helmdesk" && target.host == "cli-installation" &&
        ["", "/"].contains(target.path) && target.port == nil && target.user == nil &&
        target.password == nil && target.query == nil && target.fragment == nil
    }
}
