import Foundation
import Testing
@testable import HelmDesk

@Test func browserEntryIsBoundToAcceptedInstanceAndNeverContainsPermanentBearer() throws {
    let connection = ServiceConnection(service: "helmdesk", protocolVersion: 1,
        instanceId: "11111111-1111-4111-8111-111111111111", dataDirectory: "/tmp/fixture",
        port: 54321, pid: 1234, token: String(repeating: "b", count: 64))
    let entry = BrowserEntry(ticket: String(repeating: "a", count: 64), expiresAt: "fixture", instanceId: connection.instanceId)
    let url = try entry.url(for: connection)
    #expect(url.scheme == "http" && url.host == "127.0.0.1" && url.port == 54321)
    #expect(url.query == nil && url.fragment == "helmdesk-ticket=" + entry.ticket)
    #expect(!url.absoluteString.contains(connection.token))
    #expect(throws: ServiceError.self) { try BrowserEntry(ticket: entry.ticket, expiresAt: "fixture", instanceId: "other").url(for: connection) }
    for malformed in ["short", String(repeating: "a", count: 64) + "\n", "https://foreign.invalid", String(repeating: "A", count: 64)] {
        #expect(throws: ServiceError.self) { try BrowserEntry(ticket: malformed, expiresAt: "fixture", instanceId: connection.instanceId).url(for: connection) }
    }
}
