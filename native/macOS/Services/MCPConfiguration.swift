import Foundation

enum MCPConfiguration {
    static func render(runtime: URL, entry: URL, directory: URL) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        func quoted<T: Encodable>(_ value: T) throws -> String { String(decoding: try encoder.encode(value), as: UTF8.self) }
        return """
        # HelmDesk 本机 stdio MCP。不会自动改写宿主配置。
        [mcp_servers.helmdesk]
        command = \(try quoted(runtime.path))
        args = \(try quoted([entry.path, "mcp", "--autostart-service", "--data-dir", directory.path]))
        startup_timeout_sec = 30
        tool_timeout_sec = 60

        """
    }
}
