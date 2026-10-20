import Foundation
import Darwin

enum CanonicalDirectory {
    /// Match Node's realpathSync, including Darwin's /private prefix.
    /// Foundation resolvingSymlinksInPath intentionally hides that prefix.
    static func path(_ directory: URL) throws -> String {
        guard let resolved = realpath(directory.path, nil) else {
            throw ServiceError.message("无法核对数据目录的真实路径，请检查目录是否存在及访问权限。")
        }
        defer { free(resolved) }
        return String(cString: resolved)
    }
}
