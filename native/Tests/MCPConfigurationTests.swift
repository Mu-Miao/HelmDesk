import Foundation
import Testing
@testable import HelmDesk

private let runtime = URL(fileURLWithPath: "/Applications/HelmDesk.app/Contents/Resources/runtime/node")
private let entry = URL(fileURLWithPath: "/Applications/HelmDesk.app/Contents/Resources/service/dist/cli.js")
private let directory = URL(fileURLWithPath: "/tmp/helmdesk-data")

private func lines(_ text: String) -> [String] {
    text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
}

private func singleValue(key: String, in text: String) throws -> String {
    let matched = lines(text).filter { $0.hasPrefix(key) }
    #expect(matched.count == 1)
    guard let line = matched.first else { throw CocoaError(.fileReadUnknown) }
    return String(line.dropFirst(key.count)).trimmingCharacters(in: .whitespaces)
}

private func decoded<T: Decodable>(_ json: String, as type: T.Type) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}

@Test func rendersStablePaths() throws {
    let text = try MCPConfiguration.render(runtime: runtime, entry: entry, directory: directory)
    #expect(lines(text).filter { $0.contains("[mcp_servers.helmdesk]") }.count == 1)
    #expect(lines(text).filter { $0.hasPrefix("command") }.count == 1)
    #expect(lines(text).filter { $0.hasPrefix("args") }.count == 1)
    #expect(text.contains("startup_timeout_sec = 30"))
    #expect(text.contains("tool_timeout_sec = 60"))
    let command = try decoded(try singleValue(key: "command =", in: text), as: String.self)
    #expect(command == runtime.path)
    let args = try decoded(try singleValue(key: "args =", in: text), as: [String].self)
    #expect(args == [entry.path, "mcp", "--autostart-service", "--data-dir", directory.path])
    #expect(!text.contains("\\/"))
}

@Test func preservesSpacesChineseQuoteBackslashAndNewline() throws {
    let hostileRuntime = "/tmp/运行 time/node \"bin\" back\\slash\nnewline"
    let hostileEntry = "/tmp/服务 dir/cli\"entry.js"
    let hostileDirectory = "/tmp/data dir\\子目录"
    let runtimeURL = URL(fileURLWithPath: hostileRuntime)
    let entryURL = URL(fileURLWithPath: hostileEntry)
    let directoryURL = URL(fileURLWithPath: hostileDirectory)
    #expect(runtimeURL.path == hostileRuntime)
    #expect(entryURL.path == hostileEntry)
    #expect(directoryURL.path == hostileDirectory)

    let text = try MCPConfiguration.render(
        runtime: runtimeURL, entry: entryURL, directory: directoryURL)
    let command = try decoded(try singleValue(key: "command =", in: text), as: String.self)
    #expect(command == hostileRuntime)
    let args = try decoded(try singleValue(key: "args =", in: text), as: [String].self)
    #expect(args == [hostileEntry, "mcp", "--autostart-service", "--data-dir", hostileDirectory])
    #expect(!text.contains("\\/"))
}

@Test func injectedNewlineStaysEscapedInSingleSection() throws {
    let runtimeURL = URL(fileURLWithPath: "/tmp/node\n[mcp_servers.evil]\ncommand = \"/bin/sh\"")
    let entryURL = URL(fileURLWithPath: "/tmp/cli.js\nargs = [\"--pwned\"]")
    let directoryURL = URL(fileURLWithPath: "/tmp/dir\nstartup_timeout_sec = 1")
    let text = try MCPConfiguration.render(
        runtime: runtimeURL, entry: entryURL, directory: directoryURL)
    let physical = lines(text)
    #expect(physical.filter { $0.hasPrefix("[") }.count == 1)
    #expect(physical.filter { $0.hasPrefix("[mcp_servers.helmdesk]") }.count == 1)
    #expect(physical.filter { $0.hasPrefix("command") }.count == 1)
    #expect(physical.filter { $0.hasPrefix("args") }.count == 1)
    #expect(!physical.contains { $0.hasPrefix("[mcp_servers.evil]") })
    #expect(!physical.contains { $0.hasPrefix("args = [\"--pwned\"]") })
    #expect(!physical.contains { $0.hasPrefix("startup_timeout_sec = 1") })
    let command = try decoded(try singleValue(key: "command =", in: text), as: String.self)
    #expect(command == runtimeURL.path)
    let args = try decoded(try singleValue(key: "args =", in: text), as: [String].self)
    #expect(args == [entryURL.path, "mcp", "--autostart-service", "--data-dir", directoryURL.path])
}
