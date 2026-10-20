import Foundation

struct ExportPolicy: Sendable {
    let origin: URL
    static let maximumBytes: Int64 = 20 * 1024 * 1024

    private static func isValidOrigin(_ url: URL) -> Bool {
        guard url.scheme == "http", url.host == "127.0.0.1",
              url.user == nil, url.password == nil,
              let port = url.port, (1024...65535).contains(port) else { return false }
        return true
    }

    func allows(_ url: URL) -> Bool {
        guard Self.isValidOrigin(origin) else { return false }
        if matchesOrigin(url) { return true }
        guard url.scheme == "blob" else { return false }
        let rest = String(url.absoluteString.dropFirst("blob:".count))
        guard let inner = URL(string: rest) else { return false }
        return matchesOrigin(inner)
    }

    private func matchesOrigin(_ url: URL) -> Bool {
        url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
            && url.user == nil && url.password == nil
    }

    static func filename(_ proposed: String) -> String? {
        let base = String(proposed.split(omittingEmptySubsequences: false,
                                         whereSeparator: { $0 == "/" || $0 == "\\" }).last ?? "")
        guard !base.isEmpty, !base.hasPrefix("."), base.count <= 200 else { return nil }
        guard !base.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else { return nil }
        let ext = (base as NSString).pathExtension.lowercased()
        guard ["md", "json", "patch"].contains(ext) else { return nil }
        return base
    }
}
