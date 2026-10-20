import Foundation
import Testing
@testable import HelmDesk

private let policy = ExportPolicy(origin: URL(string: "http://127.0.0.1:8787")!)

private func urlWithUserInfo() -> URL {
    var components = URLComponents(string: "http://127.0.0.1:8787/x.md")!
    components.user = "fixture"
    components.password = "fixture"
    return components.url!
}

@Test func acceptsSameOriginAndMatchingBlob() {
    #expect(policy.allows(URL(string: "http://127.0.0.1:8787/export/notes.md")!))
    #expect(policy.allows(URL(string: "http://127.0.0.1:8787")!))
    #expect(policy.allows(URL(string: "blob:http://127.0.0.1:8787/abc-123")!))
}

@Test func rejectsForeignAndForgedOrigins() {
    #expect(!policy.allows(URL(string: "http://127.0.0.1:9999/x.md")!))
    #expect(!policy.allows(URL(string: "http://evil.com:8787/x.md")!))
    #expect(!policy.allows(URL(string: "http://127.0.0.1.evil.com:8787/x.md")!))
    #expect(!policy.allows(URL(string: "https://127.0.0.1:8787/x.md")!))
    #expect(!policy.allows(URL(string: "http://127.0.0.1/x.md")!))
    #expect(!policy.allows(URL(string: "blob:http://127.0.0.1.evil.com:8787/x")!))
    #expect(!policy.allows(URL(string: "blob:https://127.0.0.1:8787/x")!))
    #expect(!policy.allows(URL(string: "blob:http://127.0.0.1:9999/x")!))
}

@Test func rejectsFileNullJavascriptAndUserinfo() {
    #expect(!policy.allows(URL(string: "file:///etc/passwd")!))
    #expect(!policy.allows(URL(string: "blob:null")!))
    #expect(!policy.allows(URL(string: "blob:file:///tmp/x.md")!))
    #expect(!policy.allows(URL(string: "javascript:alert(1)")!))
    #expect(!policy.allows(urlWithUserInfo()))
}

@Test func rejectsInvalidConfiguredOrigin() {
    let https = ExportPolicy(origin: URL(string: "https://127.0.0.1:8787")!)
    #expect(!https.allows(URL(string: "https://127.0.0.1:8787/x.md")!))
    let wrongHost = ExportPolicy(origin: URL(string: "http://evil.com:8787")!)
    #expect(!wrongHost.allows(URL(string: "http://evil.com:8787/x.md")!))
    let lowPort = ExportPolicy(origin: URL(string: "http://127.0.0.1:80")!)
    #expect(!lowPort.allows(URL(string: "http://127.0.0.1:80/x.md")!))
    let userinfo = ExportPolicy(origin: urlWithUserInfo())
    #expect(!userinfo.allows(URL(string: "http://127.0.0.1:8787/x.md")!))
}

@Test func filenameStripsTraversalToBasename() {
    #expect(ExportPolicy.filename("../../etc/notes.md") == "notes.md")
    #expect(ExportPolicy.filename("..\\..\\windows\\report.json") == "report.json")
    #expect(ExportPolicy.filename("mixed/dir\\change.patch") == "change.patch")
    #expect(ExportPolicy.filename("NOTES.MD") == "NOTES.MD")
    #expect(ExportPolicy.filename("a/b/c.JSON") == "c.JSON")
}

@Test func filenameRejectsEmptyHiddenAndControlNames() {
    #expect(ExportPolicy.filename("") == nil)
    #expect(ExportPolicy.filename("dir/") == nil)
    #expect(ExportPolicy.filename("dir\\") == nil)
    #expect(ExportPolicy.filename("dir//") == nil)
    #expect(ExportPolicy.filename("dir\\\\") == nil)
    #expect(ExportPolicy.filename(".hidden.md") == nil)
    #expect(ExportPolicy.filename("dir/.json") == nil)
    #expect(ExportPolicy.filename("bad\u{0}.md") == nil)
    #expect(ExportPolicy.filename("bad\n.md") == nil)
    #expect(ExportPolicy.filename("notes.txt") == nil)
    #expect(ExportPolicy.filename("notes.mdx") == nil)
    #expect(ExportPolicy.filename("notes.") == nil)
}

@Test func filenameRequiresActualDotExtension() {
    #expect(ExportPolicy.filename("md") == nil)
    #expect(ExportPolicy.filename("json") == nil)
    #expect(ExportPolicy.filename("patch") == nil)
    #expect(ExportPolicy.filename("dir/PATCH") == nil)
}

@Test func filenameLengthBoundAppliesToSanitizedBasename() {
    let longPrefix = String(repeating: "x", count: 300)
    #expect(ExportPolicy.filename(longPrefix + "/ok.md") == "ok.md")
    let maxBase = String(repeating: "a", count: 197) + ".md"
    #expect(maxBase.count == 200)
    #expect(ExportPolicy.filename(maxBase) == maxBase)
    #expect(ExportPolicy.filename("a" + maxBase) == nil)
}
