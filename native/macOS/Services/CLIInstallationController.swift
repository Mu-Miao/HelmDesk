import Foundation
import Observation

@MainActor @Observable
final class CLIInstallationController {
    let service: ServiceManager
    var snapshot: CLIInstallationSnapshot?
    var selected: Set<String> = []
    var isRequesting = false
    var message: String?
    @ObservationIgnored private var polling: Task<Void, Never>?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var observedInstance: String?

    init(service: ServiceManager) { self.service = service; observedInstance = service.instanceId }

    func connectionChanged() async {
        guard observedInstance != service.instanceId else { return }
        observedInstance = service.instanceId
        generation += 1
        polling?.cancel(); polling = nil
        snapshot = nil; selected = []; isRequesting = false; message = nil
        await refresh()
    }

    func refresh() async {
        guard !isRequesting else { return }
        let requestGeneration = generation
        isRequesting = true
        defer { if generation == requestGeneration { isRequesting = false } }
        do {
            let value: CLIInstallationSnapshot = try await service.desktopCall("installer-refresh")
            guard generation == requestGeneration else { return }
            accept(value)
            message = nil
        } catch { if generation == requestGeneration { message = error.localizedDescription } }
    }

    func install() async {
        guard !isRequesting, let snapshot, snapshot.homebrew.available, !snapshot.isRunning else { return }
        let targets = snapshot.tools.filter { selected.contains($0.id) && !$0.installed }.map(\.id)
        guard !targets.isEmpty else { return }
        let requestGeneration = generation
        isRequesting = true
        defer { if generation == requestGeneration { isRequesting = false } }
        do {
            let body = try JSONEncoder().encode(InstallationRequest(targets: targets))
            let value: CLIInstallationSnapshot = try await service.desktopCall("installer-start", body: body)
            guard generation == requestGeneration else { return }
            accept(value)
            message = nil
        } catch { if generation == requestGeneration { message = error.localizedDescription } }
    }

    func cancel() async {
        guard !isRequesting, snapshot?.isRunning == true else { return }
        let requestGeneration = generation
        isRequesting = true
        defer { if generation == requestGeneration { isRequesting = false } }
        do {
            let value: CLIInstallationSnapshot = try await service.desktopCall("installer-cancel")
            guard generation == requestGeneration else { return }
            accept(value)
            message = nil
        } catch { if generation == requestGeneration { message = error.localizedDescription } }
    }

    private func accept(_ value: CLIInstallationSnapshot) {
        snapshot = value
        selected.formIntersection(Set(value.tools.filter { !$0.installed }.map(\.id)))
        guard value.isRunning, polling == nil else { return }
        let pollingGeneration = generation
        polling = Task { [weak self] in
            guard let self else { return }
            defer { if generation == pollingGeneration { polling = nil } }
            while snapshot?.isRunning == true && !Task.isCancelled && generation == pollingGeneration {
                do {
                    try await Task.sleep(for: .seconds(1))
                    let value: CLIInstallationSnapshot = try await service.desktopCall("installer-status")
                    guard generation == pollingGeneration else { return }
                    snapshot = value
                    selected.formIntersection(Set(value.tools.filter { !$0.installed }.map(\.id)))
                } catch {
                    guard generation == pollingGeneration, !Task.isCancelled else { return }
                    message = "连接中断，安装可能仍在后台运行。请重新检测：\(error.localizedDescription)"
                    break
                }
            }
        }
    }
}

private struct InstallationRequest: Encodable { let targets: [String] }
