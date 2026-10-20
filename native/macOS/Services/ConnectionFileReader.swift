import Foundation
import Darwin

/// Call on a utility executor: macOS may wait for folder-access consent at open().
enum ConnectionFileReader {
    static func read(directory: URL) throws -> ServiceConnection? {
        let file = directory.appending(path: "connection.json")
        let descriptor = open(file.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard descriptor >= 0 else {
            if errno == ENOENT { return nil }
            throw ServiceError.message("无法读取连接记录。请通过设置选择数据目录，并确认 macOS 文件夹访问权限。")
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var information = stat()
        guard fstat(descriptor, &information) == 0,
              information.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              information.st_uid == getuid(), information.st_mode & 0o077 == 0,
              information.st_size >= 0, information.st_size <= 16384 else {
            throw ServiceError.message("连接记录必须是当前用户的私有普通文件，且不能超过 16 KB。")
        }
        let bytes = try handle.read(upToCount: 16385) ?? Data()
        guard bytes.count <= 16384 else { throw ServiceError.message("连接记录超过大小限制。") }
        let connection = try JSONDecoder().decode(ServiceConnection.self, from: bytes)
        try connection.validate(directory: directory)
        return connection
    }
}
