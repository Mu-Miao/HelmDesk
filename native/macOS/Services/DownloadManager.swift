import SwiftUI
import WebKit
import UniformTypeIdentifiers
import OSLog

@MainActor
final class DownloadManager: NSObject, WKDownloadDelegate {
    private let policy: ExportPolicy
    private let onMessage: @MainActor (String) -> Void
    private let logger = Logger(subsystem: "cn.helmdesk.mac", category: "Export")
    private var transfers: [ObjectIdentifier: Transfer] = [:]

    private final class Transfer {
        let download: WKDownload
        let staging: URL
        let destination: URL
        var monitor: Task<Void, Never>?
        var cancellation: String?
        init(download: WKDownload, staging: URL, destination: URL) {
            self.download = download; self.staging = staging; self.destination = destination
        }
    }

    init(origin: URL, onMessage: @escaping @MainActor (String) -> Void) {
        policy = ExportPolicy(origin: origin)
        self.onMessage = onMessage
    }

    func receive(_ download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        guard let url = download.originalRequest?.url, policy.allows(url),
              let filename = ExportPolicy.filename(suggestedFilename),
              response.expectedContentLength <= ExportPolicy.maximumBytes, transfers.count < 4 else {
            logger.error("export.rejected")
            onMessage("无法导出：来源、文件类型或大小不符合要求。")
            completionHandler(nil); return
        }
        let panel = NSSavePanel()
        panel.title = "保存领航台交付"
        panel.message = "导出内容可能包含项目内容，请选择保存位置。"
        panel.nameFieldStringValue = filename
        panel.isExtensionHidden = false
        panel.allowedContentTypes = [UTType(filenameExtension: (filename as NSString).pathExtension) ?? .plainText]
        panel.allowsOtherFileTypes = false
        guard panel.runModal() == .OK, let destination = panel.url,
              ExportPolicy.filename(destination.lastPathComponent) != nil else {
            onMessage("已取消导出"); completionHandler(nil); return
        }
        // The modal panel pumps AppKit events; another download may have started meanwhile.
        guard transfers.count < 4 else {
            onMessage("同时导出数量已达上限，请等待现有导出完成。")
            completionHandler(nil); return
        }
        do {
            let staging = FileManager.default.temporaryDirectory.appending(path: "HelmDesk-export-\(UUID().uuidString)", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let id = ObjectIdentifier(download)
            let transfer = Transfer(download: download, staging: staging, destination: destination)
            transfers[id] = transfer
            transfer.monitor = Task { [weak self, weak download] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .milliseconds(200)) } catch { return }
                    guard let self, let download, let transfer = self.transfers[id] else { return }
                    if download.progress.completedUnitCount > ExportPolicy.maximumBytes {
                        transfer.cancellation = "导出超过 20 MB 限制，已取消。"
                        _ = await download.cancel()
                        self.complete(id, message: "导出超过 20 MB 限制，已取消。")
                        return
                    }
                }
            }
            logger.notice("export.started")
            onMessage("正在保存导出…")
            completionHandler(staging.appending(path: "delivery"))
        } catch {
            onMessage("无法创建导出临时文件，请检查磁盘空间与权限。")
            completionHandler(nil)
        }
    }

    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest,
                  decisionHandler: @escaping @MainActor @Sendable (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(request.url.map(policy.allows) == true ? .allow : .cancel)
    }

    func downloadDidFinish(_ download: WKDownload) {
        let id = ObjectIdentifier(download)
        guard let transfer = transfers[id] else { return }
        do {
            let file = transfer.staging.appending(path: "delivery")
            let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
            guard let size = attributes[.size] as? NSNumber,
                  size.int64Value <= ExportPolicy.maximumBytes else {
                complete(id, message: "导出超过 20 MB 限制，原文件未替换。"); return
            }
            try Data(contentsOf: file).write(to: transfer.destination, options: .atomic)
            logger.notice("export.saved")
            complete(id, message: "导出已保存")
        } catch {
            logger.error("export.save_failed")
            complete(id, message: "导出保存失败，请检查目标目录权限和空间。")
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let id = ObjectIdentifier(download)
        let message = transfers[id]?.cancellation ?? ((error as NSError).code == NSURLErrorCancelled ? "已取消导出" : "导出失败，请重试。")
        complete(id, message: message)
    }

    private func complete(_ id: ObjectIdentifier, message: String) {
        guard let transfer = transfers.removeValue(forKey: id) else { return }
        transfer.monitor?.cancel()
        try? FileManager.default.removeItem(at: transfer.staging)
        onMessage(message)
    }

    func cancelAll() {
        let pending = transfers
        transfers.removeAll()
        for transfer in pending.values {
            transfer.monitor?.cancel()
            transfer.download.cancel(nil)
            try? FileManager.default.removeItem(at: transfer.staging)
        }
    }
}
