import Foundation
import Testing
@testable import HelmDesk

@Test func automaticExecutorIsEncodedAsExplicitNull() throws {
    let config = DesktopConfiguration(qoderCLI: nil, projectRoots: ["/tmp/project"], preferredPort: 4317)
    let bytes = try JSONEncoder().encode(config)
    let value = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
    #expect(value["qoderCLI"] is NSNull)
    #expect((try JSONDecoder().decode(DesktopConfiguration.self, from: bytes)).projectRoots == ["/tmp/project"])
}

@Test func startupDiagnosticsClassifyWithoutLeakingRawLogs() {
    let cases: [(String, StartupFailure)] = [("listen EADDRINUSE", .portConflict), ("数据库版本较新", .databaseIncompatible), ("数据库结构不兼容", .databaseIncompatible), ("EACCES", .permissions), ("sandbox failed", .isolation), ("进程清理未确认", .processCleanup), ("Qoder CLI missing", .executor), ("unrecognized", .unknown)]
    for (log, expected) in cases {
        let failure = StartupFailure(log: log + " opaque-private-fixture")
        #expect(failure == expected)
        #expect(!failure.localizedDescription.contains("opaque-private-fixture"))
    }
}
