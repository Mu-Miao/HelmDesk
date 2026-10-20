import Foundation
import Testing
import Darwin
@testable import HelmDesk

@Suite("Private connection file")
struct ConnectionFileReaderTests {
    private func fixture(_ body: (URL, URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "helm-connection-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(directory.resolvingSymlinksInPath(), directory.appending(path: "connection.json"))
    }

    @Test func acceptsPrivateRecordAndMissingRecord() throws {
        try fixture { directory, file in
            #expect(try ConnectionFileReader.read(directory: directory) == nil)
            let value: [String: Any] = ["service": "helmdesk", "protocolVersion": 1, "instanceId": UUID().uuidString,
                                      "dataDirectory": try CanonicalDirectory.path(directory), "port": 4317, "pid": 42, "token": String(repeating: "a", count: 64)]
            try JSONSerialization.data(withJSONObject: value).write(to: file)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            #expect(try ConnectionFileReader.read(directory: directory)?.port == 4317)
        }
    }

    @Test func acceptsPOSIXPrivatePathAndRejectsFoundationAlias() throws {
        try fixture { directory, file in
            let canonical = try CanonicalDirectory.path(directory)
            // macOS's temporary directory lives under /private/var; Node preserves it.
            #expect(canonical.hasPrefix("/private/"))
            #expect(canonical != directory.resolvingSymlinksInPath().path)
            var value: [String: Any] = ["service": "helmdesk", "protocolVersion": 1, "instanceId": UUID().uuidString,
                                       "dataDirectory": canonical, "port": 4317, "pid": 42, "token": String(repeating: "a", count: 64)]
            try JSONSerialization.data(withJSONObject: value).write(to: file)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            #expect(try ConnectionFileReader.read(directory: directory)?.dataDirectory == canonical)
            value["dataDirectory"] = directory.resolvingSymlinksInPath().path
            try JSONSerialization.data(withJSONObject: value).write(to: file)
            #expect(throws: ServiceError.self) { try ConnectionFileReader.read(directory: directory) }
        }
    }

    @Test func rejectsSharedOversizedAndMalformedRecords() throws {
        try fixture { directory, file in
            try Data("{}".utf8).write(to: file)
            try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
            #expect(throws: ServiceError.self) { try ConnectionFileReader.read(directory: directory) }
            try Data(repeating: 32, count: 16385).write(to: file)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            #expect(throws: ServiceError.self) { try ConnectionFileReader.read(directory: directory) }
            try Data("not json".utf8).write(to: file)
            #expect(throws: DecodingError.self) { try ConnectionFileReader.read(directory: directory) }
        }
    }

    @Test func rejectsSymlinksAndFifosWithoutBlocking() throws {
        try fixture { directory, file in
            let target = directory.appending(path: "target")
            try Data("{}".utf8).write(to: target)
            try FileManager.default.createSymbolicLink(at: file, withDestinationURL: target)
            #expect(throws: ServiceError.self) { try ConnectionFileReader.read(directory: directory) }
            try FileManager.default.removeItem(at: file)
            #expect(mkfifo(file.path, 0o600) == 0)
            #expect(throws: ServiceError.self) { try ConnectionFileReader.read(directory: directory) }
        }
    }
}
