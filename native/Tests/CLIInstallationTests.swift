import Foundation
import Testing
@testable import HelmDesk

@Test func installerLinkRequiresLocalMainFrameAndUserActivatedExactRoute() throws {
    let origin = try #require(URL(string: "http://127.0.0.1:4317/"))
    let target = try #require(URL(string: "helmdesk://cli-installation"))
    #expect(InstallerNavigationPolicy.allows(target, sourceOrigin: origin, expectedOrigin: origin, mainFrame: true, linkActivated: true))
    for route in ["helmdesk://cli-installation?command=bad", "helmdesk://cli-installation#bad", "helmdesk://cli-installation/extra", "helmdesk://user@cli-installation", "https://cli-installation", "helmdesk://cli-installation:123"] {
        let url = try #require(URL(string: route))
        #expect(!InstallerNavigationPolicy.allows(url, sourceOrigin: origin, expectedOrigin: origin, mainFrame: true, linkActivated: true))
    }
    #expect(!InstallerNavigationPolicy.allows(target, sourceOrigin: origin, expectedOrigin: origin, mainFrame: false, linkActivated: true))
    #expect(!InstallerNavigationPolicy.allows(target, sourceOrigin: origin, expectedOrigin: origin, mainFrame: true, linkActivated: false))
    for source in ["https://foreign.test", "http://127.0.0.1:4318", "https://127.0.0.1:4317"] {
        #expect(!InstallerNavigationPolicy.allows(target, sourceOrigin: try #require(URL(string: source)), expectedOrigin: origin, mainFrame: true, linkActivated: true))
    }
}

@Test func installerSnapshotPreservesMissingBrewAndPartialFailure() throws {
    let fixture = Data("""
    {"checking":false,"homebrew":{"supported":true,"available":false,"path":null,"version":null,"reason":"请安装 Homebrew"},"tools":[{"id":"ollama","label":"Ollama","installed":false,"version":null,"method":"Homebrew","sourceURL":"https://formulae.brew.sh/formula/ollama","detail":"不下载模型"}],"job":{"id":"job","state":"failed","targets":["antigravity","ollama"],"activeTarget":null,"completedTargets":["antigravity"],"message":"Ollama 安装失败","log":"bounded output","startedAt":"now","finishedAt":"later"}}
    """.utf8)
    let state = try JSONDecoder().decode(CLIInstallationSnapshot.self, from: fixture)
    #expect(!state.homebrew.available)
    #expect(!state.isRunning)
    #expect(state.job?.completedTargets == ["antigravity"])
    #expect(state.tools.first?.installed == false)
}

@Test func opaqueInitialWebKitOriginsDoNotConstructOrTrapOnInvalidSchemes() throws {
    let origin = try #require(URL(string: "http://127.0.0.1:4317/"))
    let target = try #require(URL(string: "helmdesk://cli-installation"))
    for scheme in ["", ":", "null", "about", "invalid scheme", "\n"] {
        #expect(!InstallerNavigationPolicy.allows(target, sourceScheme: scheme, sourceHost: "", sourcePort: 0,
                                                 expectedOrigin: origin, mainFrame: true, linkActivated: true))
    }
}
