import Foundation

struct ReportTaskPage: Decodable, Sendable {
    let items: [Item]
    let total: Int
    let nextCursor: String?
    struct Item: Decodable, Identifiable, Sendable {
        let id: String
        let title: String
        let state: String
        let acceptance: String
        var stateLabel: String { ["queued":"排队中","preparing":"准备中","running":"执行中","waiting_user":"待核实","completed":"已完成","failed":"失败","cancelled":"已取消"][state] ?? "未知" }
        var acceptanceLabel: String { ["pending":"待验收","accepted":"已验收","changes_requested":"需要返工"][acceptance] ?? "未知" }
    }
}
