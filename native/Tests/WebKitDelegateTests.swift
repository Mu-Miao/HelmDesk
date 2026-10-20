import Foundation
import Testing
@testable import HelmDesk

@Test @MainActor
func javascriptDialogsRegisterObjectiveCDelegateSelectors() throws {
    let coordinator = DeskWebView.Coordinator(origin: try #require(URL(string: "http://127.0.0.1:4317/")), onError: { _ in }, onExport: { _ in })
    for selector in [
        "webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:",
        "webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:"
    ] {
        #expect(coordinator.responds(to: NSSelectorFromString(selector)))
    }
}
