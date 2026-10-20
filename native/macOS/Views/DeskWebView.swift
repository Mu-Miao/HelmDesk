import SwiftUI
import WebKit

struct DeskWebView: NSViewRepresentable {
    let url: URL
    let onError: @MainActor (String) -> Void
    let onExport: @MainActor (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(origin: url, onError: onError, onExport: onExport) }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.load(URLRequest(url: url))
        return view
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    static func dismantleNSView(_ nsView: WKWebView, coordinator: Coordinator) {
        nsView.stopLoading(); nsView.navigationDelegate = nil; nsView.uiDelegate = nil
        coordinator.downloads.cancelAll()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let origin: URL
        let onError: @MainActor (String) -> Void
        let downloads: DownloadManager
        init(origin: URL, onError: @escaping @MainActor (String) -> Void, onExport: @escaping @MainActor (String) -> Void) {
            self.origin = origin; self.onError = onError
            downloads = DownloadManager(origin: origin, onMessage: onExport)
        }

        func isLocal(_ url: URL) -> Bool {
            url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            guard let target = navigationAction.request.url else { decisionHandler(.cancel); return }
            let source = navigationAction.sourceFrame.securityOrigin
            let sourceMatches = navigationAction.sourceFrame.isMainFrame && source.protocol == origin.scheme && source.host == origin.host && source.port == origin.port
            if sourceMatches, ExportPolicy(origin: origin).allows(target), navigationAction.shouldPerformDownload || target.scheme == "blob" {
                decisionHandler(.download); return
            }
            if isLocal(target), navigationAction.targetFrame?.isMainFrame == true {
                decisionHandler(.allow); return
            }
            if navigationAction.navigationType == .linkActivated {
                if ["http", "https"].contains(target.scheme ?? "") { NSWorkspace.shared.open(target) }
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            downloads.receive(download)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                     decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
            guard navigationResponse.isForMainFrame, let url = navigationResponse.response.url, isLocal(url) else {
                decisionHandler(.cancel); return
            }
            decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
            downloads.receive(download)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { onError("网页加载失败：\(error.localizedDescription)") }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { onError("网页连接中断：\(error.localizedDescription)") }
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            onError("网页进程已结束。请重新连接；后台任务仍由独立服务管理。")
        }

        // WebKit's imported reply isolation differs in the Swift 6.2 and 6.3 SDKs.
        // Keep exact optional delegate signatures; the coordinator stays on MainActor.
        #if compiler(>=6.3)
        typealias AlertReply = @MainActor @Sendable () -> Void
        typealias ConfirmReply = @MainActor @Sendable (Bool) -> Void
        #else
        typealias AlertReply = @Sendable () -> Void
        typealias ConfirmReply = @Sendable (Bool) -> Void
        #endif

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping AlertReply) {
            guard frame.isMainFrame else { completionHandler(); return }
            let alert = NSAlert(); alert.messageText = String(message.prefix(2000)); alert.runModal()
            completionHandler()
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ConfirmReply) {
            guard frame.isMainFrame else { completionHandler(false); return }
            let alert = NSAlert(); alert.messageText = String(message.prefix(2000))
            alert.addButton(withTitle: "确认"); alert.addButton(withTitle: "取消")
            completionHandler(alert.runModal() == .alertFirstButtonReturn)
        }
    }
}
