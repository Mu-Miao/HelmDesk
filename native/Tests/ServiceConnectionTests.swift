import Testing
import Foundation
@testable import HelmDesk

private let fakeDirectory = URL(fileURLWithPath: try! CanonicalDirectory.path(FileManager.default.temporaryDirectory))
private let fakeToken = String(repeating: "ab12", count: 16)

private func makeConnection(
    service: String = "helmdesk",
    protocolVersion: Int = 1,
    instanceId: String = "1B4D2C6A-8F3E-4A7B-9C0D-2E5F6A7B8C9D",
    dataDirectory: String = fakeDirectory.path,
    port: Int = 8765,
    pid: Int = 4242,
    token: String = fakeToken
) -> ServiceConnection {
    ServiceConnection(service: service, protocolVersion: protocolVersion,
                      instanceId: instanceId, dataDirectory: dataDirectory,
                      port: port, pid: pid, token: token)
}

private func makeIdentity(
    service: String = "helmdesk",
    protocolVersion: Int = 1,
    instanceId: String = "1B4D2C6A-8F3E-4A7B-9C0D-2E5F6A7B8C9D",
    dataDirectory: String = fakeDirectory.path,
    port: Int = 8765,
    version: String = "0.1.0",
    activeTasks: Int = 0
) -> ServiceIdentity {
    ServiceIdentity(service: service, protocolVersion: protocolVersion,
                    instanceId: instanceId, dataDirectory: dataDirectory,
                    port: port, version: version, activeTasks: activeTasks)
}

@Suite("ServiceConnection validation")
struct ServiceConnectionTests {
    @Test("accepts a well-formed connection record")
    func acceptsValidConnection() throws {
        #expect(throws: Never.self) {
            try makeConnection().validate(directory: fakeDirectory)
        }
    }

    @Test("rejects foreign service or protocol version")
    func rejectsForeignServiceOrProtocol() {
        #expect(throws: ServiceError.self) {
            try makeConnection(service: "other-agent").validate(directory: fakeDirectory)
        }
        #expect(throws: ServiceError.self) {
            try makeConnection(protocolVersion: 2).validate(directory: fakeDirectory)
        }
    }

    @Test("rejects a non-UUID instance id")
    func rejectsNonUUIDInstance() {
        #expect(throws: ServiceError.self) {
            try makeConnection(instanceId: "not-a-uuid").validate(directory: fakeDirectory)
        }
    }

    @Test("rejects an invalid token")
    func rejectsInvalidToken() {
        #expect(throws: ServiceError.self) {
            try makeConnection(token: "short").validate(directory: fakeDirectory)
        }
        #expect(throws: ServiceError.self) {
            try makeConnection(token: String(repeating: "zz", count: 32))
                .validate(directory: fakeDirectory)
        }
    }

    @Test("rejects out-of-range ports")
    func rejectsOutOfRangePort() {
        #expect(throws: ServiceError.self) {
            try makeConnection(port: 1023).validate(directory: fakeDirectory)
        }
        #expect(throws: ServiceError.self) {
            try makeConnection(port: 65536).validate(directory: fakeDirectory)
        }
    }

    @Test("rejects a pid of 1 or less")
    func rejectsSmallPid() {
        #expect(throws: ServiceError.self) {
            try makeConnection(pid: 1).validate(directory: fakeDirectory)
        }
        #expect(throws: ServiceError.self) {
            try makeConnection(pid: 0).validate(directory: fakeDirectory)
        }
    }

    @Test("rejects a data directory other than the canonical one")
    func rejectsWrongDataDirectory() {
        #expect(throws: ServiceError.self) {
            try makeConnection(dataDirectory: "/private/tmp/helmdesk-other")
                .validate(directory: fakeDirectory)
        }
    }
}

@Suite("ServiceIdentity handshake validation")
struct ServiceIdentityTests {
    @Test("accepts an identity matching the connection record")
    func acceptsMatchingIdentity() throws {
        #expect(throws: Never.self) {
            try makeIdentity().validate(connection: makeConnection())
        }
    }

    @Test("rejects handshake mismatches on instance, port, or path")
    func rejectsHandshakeMismatch() {
        #expect(throws: ServiceError.self) {
            try makeIdentity(instanceId: "9A8B7C6D-5E4F-4A3B-2C1D-0E9F8A7B6C5D")
                .validate(connection: makeConnection())
        }
        #expect(throws: ServiceError.self) {
            try makeIdentity(port: 9999).validate(connection: makeConnection())
        }
        #expect(throws: ServiceError.self) {
            try makeIdentity(dataDirectory: "/private/tmp/helmdesk-other")
                .validate(connection: makeConnection())
        }
    }

    @Test("rejects a negative activeTasks count")
    func rejectsNegativeActiveTasks() {
        #expect(throws: ServiceError.self) {
            try makeIdentity(activeTasks: -1).validate(connection: makeConnection())
        }
    }
}
