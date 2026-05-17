import Combine
import Darwin
import Foundation
import Network

@MainActor
enum OttoRuntimeStatus: Equatable {
    case stopped
    case starting
    case ready
    case failed(String)

    var isStarting: Bool {
        if case .starting = self { return true }
        return false
    }

    var errorMessage: String? {
        if case .failed(let message) = self { return message }
        return nil
    }
}

private struct RuntimeURLs: Equatable {
    var apiURL: URL?
    var webURL: URL?
}

@MainActor
final class OttoWorkspaceRuntimeSession: ObservableObject {
    private nonisolated static let firstRuntimePort = 19100
    private nonisolated static let lastRuntimePort = 60000
    private nonisolated static let maxPortLaunchAttempts = 20
    private nonisolated(unsafe) static var reservedPortPairs: Set<Int> = []

    let workspaceID: Workspace.ID
    let workspacePath: String

    @Published private(set) var status: OttoRuntimeStatus = .stopped
    @Published private(set) var apiURL: URL?
    @Published private(set) var webURL: URL?
    @Published private(set) var logPath: String?

    private var process: Process?
    private var readinessTask: Task<Void, Never>?
    private var isStopping = false
    private var assignedAPIPort: Int

    init(workspaceID: Workspace.ID, workspacePath: String) {
        self.workspaceID = workspaceID
        self.workspacePath = Self.expandedPath(workspacePath)
        self.assignedAPIPort = Self.reserveAvailablePortPair()
    }

    deinit {
        readinessTask?.cancel()
        process?.terminate()
        Self.releaseReservedPortPair(assignedAPIPort)
    }

    func start() {
        start(attempt: 0)
    }

    private func start(attempt: Int) {
        if status.isStarting { return }
        if let process, process.isRunning { return }
        isStopping = false

        if !Self.isReservedPortPairUsable(assignedAPIPort) {
            Self.releaseReservedPortPair(assignedAPIPort)
            assignedAPIPort = Self.reserveAvailablePortPair(startingAt: assignedAPIPort + 1)
        }

        let apiPort = assignedAPIPort
        let apiURL = URL(string: "http://localhost:\(apiPort)")!
        let logPath = Self.runtimeLogPath(workspaceID: workspaceID, port: apiPort)

        do {
            let executableURL = try Self.ottoExecutableURL()
            let process = Process()
            process.executableURL = executableURL
            process.currentDirectoryURL = URL(fileURLWithPath: workspacePath, isDirectory: true)
            process.arguments = Self.serveArguments(executableURL: executableURL, port: apiPort)
            process.environment = Self.runtimeEnvironment()

            let logURL = URL(fileURLWithPath: logPath)
            FileManager.default.createFile(atPath: logPath, contents: nil)
            let logHandle = try FileHandle(forWritingTo: logURL)
            process.standardOutput = logHandle
            process.standardError = logHandle

            process.terminationHandler = { [weak self] exitedProcess in
                guard let runtime = self else { return }
                Task { @MainActor [weak runtime] in
                    guard let runtime else { return }
                    guard runtime.process === exitedProcess, runtime.status.isStarting, !runtime.isStopping else {
                        return
                    }
                    let tailLog = Self.tailLog(logPath: logPath)
                    if Self.logIndicatesPortConflict(tailLog), runtime.retryWithNextPort(after: apiPort, attempt: attempt) {
                        return
                    }
                    runtime.status = .failed(
                        "otto serve exited early with status \(exitedProcess.terminationStatus).\n\(tailLog)"
                    )
                }
            }

            self.process = process
            self.apiURL = apiURL
            self.webURL = nil
            self.logPath = logPath
            status = .starting
            try process.run()
            waitUntilReady(apiPort: apiPort, logPath: logPath, attempt: attempt)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    func stop(waitUntilExit: Bool = false) {
        isStopping = true
        readinessTask?.cancel()
        readinessTask = nil
        guard let process else {
            status = .stopped
            return
        }
        if process.isRunning {
            process.terminate()
            if waitUntilExit {
                if !Self.waitForExit(process, timeout: 2) {
                    process.interrupt()
                }
                if !Self.waitForExit(process, timeout: 1) {
                    Self.forceKill(process)
                    _ = Self.waitForExit(process, timeout: 1)
                }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    if process.isRunning {
                        process.interrupt()
                    }
                }
            }
        }
        self.process = nil
        status = .stopped
    }

    func restart() {
        stop()
        start()
    }

    private func retryWithNextPort(after port: Int, attempt: Int) -> Bool {
        guard attempt < Self.maxPortLaunchAttempts else { return false }
        readinessTask?.cancel()
        readinessTask = nil
        process = nil
        Self.releaseReservedPortPair(assignedAPIPort)
        assignedAPIPort = Self.reserveAvailablePortPair(startingAt: port + 1)
        status = .stopped
        start(attempt: attempt + 1)
        return true
    }

    private func waitUntilReady(apiPort: Int, logPath: String, attempt: Int) {
        readinessTask?.cancel()
        readinessTask = Task { [weak self] in
            let deadline = Date().addingTimeInterval(30)
            while !Task.isCancelled, Date() < deadline {
                let emittedURLs = Self.parseRuntimeURLs(logPath: logPath)
                let apiURL = emittedURLs.apiURL ?? URL(string: "http://localhost:\(apiPort)")!
                let apiReady = await Self.isAPIReady(url: apiURL)

                await MainActor.run {
                    guard let self, self.status.isStarting else { return }
                    self.apiURL = emittedURLs.apiURL ?? self.apiURL ?? apiURL
                    if let webURL = emittedURLs.webURL {
                        self.webURL = webURL
                    }
                }

                if apiReady, emittedURLs.webURL != nil {
                    await MainActor.run {
                        guard let self, self.status.isStarting else { return }
                        self.status = .ready
                    }
                    return
                }

                let stillRunning = await MainActor.run { self?.process?.isRunning ?? false }
                if !stillRunning {
                    await MainActor.run {
                        guard let self, self.status.isStarting else { return }
                        let tailLog = Self.tailLog(logPath: logPath)
                        if Self.logIndicatesPortConflict(tailLog), self.retryWithNextPort(after: apiPort, attempt: attempt) {
                            return
                        }
                        self.status = .failed("otto serve exited before becoming ready.")
                    }
                    return
                }

                try? await Task.sleep(for: .milliseconds(250))
            }

            await MainActor.run {
                guard let self, self.status.isStarting else { return }
                self.status = .failed("Timed out waiting for otto serve.\n\(Self.tailLog(logPath: logPath))")
            }
        }
    }

    private static func runtimeLogPath(workspaceID: Workspace.ID, port: Int) -> String {
        let safeID = workspaceID.uuidString.lowercased()
        return NSTemporaryDirectory() + "otto-mac-runtime-\(safeID)-\(port).log"
    }

    private nonisolated static func isAPIReady(url: URL) async -> Bool {
        let url = url.appendingPathComponent("openapi.json")
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.5
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private nonisolated static func parseRuntimeURLs(logPath: String) -> RuntimeURLs {
        guard let content = try? String(contentsOfFile: logPath, encoding: .utf8) else {
            return RuntimeURLs(apiURL: nil, webURL: nil)
        }
        let stripped = stripANSI(content)
        return RuntimeURLs(
            apiURL: firstURL(in: stripped, label: "API"),
            webURL: firstURL(in: stripped, label: "Web UI")
        )
    }

    private nonisolated static func firstURL(in content: String, label: String) -> URL? {
        let escapedLabel = NSRegularExpression.escapedPattern(for: label)
        let pattern = "(?m)^\\s*\(escapedLabel)\\s+(https?://\\S+)"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(content.startIndex..<content.endIndex, in: content)
        guard let match = regex.firstMatch(in: content, range: range),
              match.numberOfRanges > 1,
              let urlRange = Range(match.range(at: 1), in: content)
        else { return nil }
        return URL(string: String(content[urlRange]))
    }

    private nonisolated static func logIndicatesReady(logPath: String) -> Bool {
        guard let content = try? String(contentsOfFile: logPath, encoding: .utf8) else { return false }
        let stripped = stripANSI(content)
        return stripped.contains("Press Ctrl+C to stop") || (stripped.contains("API") && stripped.contains("Web UI"))
    }

    private nonisolated static func tailLog(logPath: String) -> String {
        guard let content = try? String(contentsOfFile: logPath, encoding: .utf8) else { return "" }
        let lines = stripANSI(content).split(separator: "\n", omittingEmptySubsequences: false)
        return lines.suffix(40).joined(separator: "\n")
    }

    private nonisolated static func logIndicatesPortConflict(_ value: String) -> Bool {
        let lowercased = value.lowercased()
        return lowercased.contains("address already in use") ||
            lowercased.contains("eaddrinuse") ||
            lowercased.contains("port") && lowercased.contains("in use") ||
            lowercased.contains("failed to start server") && lowercased.contains("is port")
    }

    private nonisolated static func stripANSI(_ value: String) -> String {
        value.replacingOccurrences(
            of: #"\x1B\[[0-?]*[ -/]*[@-~]"#,
            with: "",
            options: .regularExpression
        )
    }

    private static func reserveAvailablePortPair(startingAt startPort: Int = firstRuntimePort) -> Int {
        let firstCandidate = max(firstRuntimePort, startPort)
        for port in firstCandidate..<lastRuntimePort where isPortPairUsable(port) {
            reservedPortPairs.insert(port)
            return port
        }
        for port in firstRuntimePort..<firstCandidate where isPortPairUsable(port) {
            reservedPortPairs.insert(port)
            return port
        }
        reservedPortPairs.insert(firstRuntimePort)
        return firstRuntimePort
    }

    private nonisolated static func releaseReservedPortPair(_ port: Int) {
        reservedPortPairs.remove(port)
    }

    private static func isReservedPortPairUsable(_ port: Int) -> Bool {
        reservedPortPairs.contains(port) && isPortPairAvailable(port)
    }

    private static func isPortPairUsable(_ port: Int) -> Bool {
        !isPortPairReserved(port) && isPortPairAvailable(port)
    }

    private static func isPortPairReserved(_ port: Int) -> Bool {
        reservedPortPairs.contains { reservedPort in
            abs(reservedPort - port) <= 1
        }
    }

    private static func isPortPairAvailable(_ port: Int) -> Bool {
        isPortAvailable(port) && isPortAvailable(port + 1)
    }

    private static func isPortAvailable(_ port: Int) -> Bool {
        guard port > 0, port < 65536 else { return false }
        return canBindIPv4Loopback(port) && canBindIPv6Loopback(port)
    }

    private static func canBindIPv4Loopback(_ port: Int) -> Bool {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { close(descriptor) }

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                Darwin.bind(descriptor, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }

    private static func canBindIPv6Loopback(_ port: Int) -> Bool {
        let descriptor = socket(AF_INET6, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { close(descriptor) }

        var address = sockaddr_in6()
        address.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
        address.sin6_family = sa_family_t(AF_INET6)
        address.sin6_port = in_port_t(port).bigEndian
        address.sin6_addr = in6addr_loopback

        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                Darwin.bind(descriptor, socketAddress, socklen_t(MemoryLayout<sockaddr_in6>.size)) == 0
            }
        }
    }

    private static func waitForExit(_ process: Process, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning, Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        return !process.isRunning
    }

    private static func forceKill(_ process: Process) {
        Darwin.kill(process.processIdentifier, SIGKILL)
    }

    private static func ottoExecutableURL() throws -> URL {
        for candidate in ottoExecutableCandidates() where FileManager.default.isExecutableFile(atPath: candidate.path) {
            return candidate
        }
        throw RuntimeError.missingBundledCLI
    }

    private static func serveArguments(executableURL: URL, port: Int) -> [String] {
        ["serve", "--port", String(port), "--no-open"]
    }

    private static func ottoExecutableCandidates() -> [URL] {
        let binaryName = platformBinaryName()
        var candidates: [URL] = []
        if let resourceURL = Bundle.main.resourceURL {
            candidates.append(resourceURL.appendingPathComponent("resources/binaries/\(binaryName)"))
            candidates.append(resourceURL.appendingPathComponent("binaries/\(binaryName)"))
            candidates.append(resourceURL.appendingPathComponent(binaryName))
        }
        return candidates
    }

    private static func platformBinaryName() -> String {
        #if arch(arm64)
        return "otto-darwin-arm64"
        #else
        return "otto-darwin-x64"
        #endif
    }

    private static func runtimeEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let paths = [
            "/usr/bin",
            "/bin",
            environment["PATH"] ?? ""
        ]
        environment["PATH"] = paths.filter { !$0.isEmpty }.joined(separator: ":")
        environment["TERM"] = "xterm-256color"
        return environment
    }

    static func expandedPath(_ path: String) -> String {
        (path as NSString).expandingTildeInPath
    }
}

private enum RuntimeError: LocalizedError {
    case missingBundledCLI

    var errorDescription: String? {
        switch self {
        case .missingBundledCLI:
            "Bundled otto CLI was not found in app resources. Rebuild the mac app so the Copy Bundled CLI build phase can place otto-darwin-* under Contents/Resources/binaries."
        }
    }
}
