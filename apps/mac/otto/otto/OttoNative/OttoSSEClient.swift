import Foundation

/// Server-Sent Events stream client backed by `URLSession.bytes(for:)`.
///
/// Mirrors the behavior of `packages/web-sdk/src/lib/sse-client.ts`:
/// - parses `event:` / `data:` / `:comment` lines, dispatched on blank-line boundaries
/// - decodes JSON payloads and emits a strongly typed `OttoSSEEvent`
/// - supports per-event-type handlers and a wildcard `*` handler
/// - allows GET (localhost) and POST (tunnel) like the web SDK
///
/// The client is an actor so subscribers can attach/detach from any task.
actor OttoSSEClient {
    enum Method: String { case get = "GET", post = "POST" }

    typealias Handler = @Sendable (OttoSSEEvent) -> Void

    private var task: Task<Void, Never>?
    private var handlers: [String: [UUID: Handler]] = [:]
    private(set) var isConnected = false

    // MARK: - Subscription

    @discardableResult
    func on(_ eventType: String, _ handler: @escaping Handler) -> OttoSSESubscription {
        let id = UUID()
        handlers[eventType, default: [:]][id] = handler
        return OttoSSESubscription(eventType: eventType, id: id, client: self)
    }

    func off(eventType: String, id: UUID) {
        guard var bucket = handlers[eventType] else { return }
        bucket.removeValue(forKey: id)
        if bucket.isEmpty {
            handlers.removeValue(forKey: eventType)
        } else {
            handlers[eventType] = bucket
        }
    }

    // MARK: - Lifecycle

    func connect(url: URL, method: Method? = nil) {
        disconnect()
        let resolvedMethod: Method = method ?? Self.preferredMethod(for: url)
        isConnected = true
        task = Task { [weak self] in
            await self?.runStream(url: url, method: resolvedMethod)
        }
    }

    func disconnect() {
        task?.cancel()
        task = nil
        isConnected = false
    }

    // MARK: - Streaming

    private func runStream(url: URL, method: Method) async {
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.timeoutInterval = TimeInterval.greatestFiniteMagnitude

        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                #if DEBUG
                print("[SSE] connection failed: \((response as? HTTPURLResponse)?.statusCode ?? -1)")
                #endif
                isConnected = false
                return
            }

            var rawEvent = ""
            for try await line in bytes.lines {
                if Task.isCancelled { break }
                if line.isEmpty {
                    await dispatch(rawEvent: rawEvent)
                    rawEvent = ""
                } else {
                    rawEvent.append(line)
                    rawEvent.append("\n")
                }
            }
            // Flush trailing event if the server closed without a blank line.
            if !rawEvent.isEmpty {
                await dispatch(rawEvent: rawEvent)
            }
        } catch is CancellationError {
            // Normal stop
        } catch {
            #if DEBUG
            print("[SSE] connection error: \(error)")
            #endif
        }
        isConnected = false
    }

    private func dispatch(rawEvent: String) async {
        guard !rawEvent.isEmpty else { return }
        var eventType = "message"
        var data = ""
        for line in rawEvent.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("event: ") {
                eventType = String(line.dropFirst(7)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("event:") {
                eventType = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data: ") {
                if !data.isEmpty { data.append("\n") }
                data.append(String(line.dropFirst(6)))
            } else if line.hasPrefix("data:") {
                if !data.isEmpty { data.append("\n") }
                data.append(String(line.dropFirst(5)))
            } else if line.hasPrefix(":") {
                // Comment / heartbeat — ignore.
            }
        }

        guard !data.isEmpty else { return }
        guard let bytes = data.data(using: .utf8) else { return }

        let payload: OttoJSONValue
        do {
            payload = try JSONDecoder().decode(OttoJSONValue.self, from: bytes)
        } catch {
            #if DEBUG
            print("[SSE] failed to parse \(eventType): \(error)")
            #endif
            return
        }

        let event = OttoSSEEvent(type: eventType, payload: payload)
        emit(event)
    }

    private func emit(_ event: OttoSSEEvent) {
        let exact = handlers[event.type]?.values ?? [:].values
        let wild = handlers["*"]?.values ?? [:].values
        for handler in exact { handler(event) }
        for handler in wild { handler(event) }
    }

    // MARK: - Helpers

    private static func preferredMethod(for url: URL) -> Method {
        let host = url.host ?? ""
        let isLocal = host == "localhost" || host == "127.0.0.1" || host.isEmpty
        return isLocal ? .get : .post
    }
}

/// Handle returned from `OttoSSEClient.on` for removing a subscription.
nonisolated struct OttoSSESubscription: Sendable {
    let eventType: String
    let id: UUID
    private let client: OttoSSEClient

    init(eventType: String, id: UUID, client: OttoSSEClient) {
        self.eventType = eventType
        self.id = id
        self.client = client
    }

    func cancel() {
        let eventType = eventType
        let id = id
        let client = client
        Task { await client.off(eventType: eventType, id: id) }
    }
}

/// Single SSE event payload.
nonisolated struct OttoSSEEvent: Sendable {
    let type: String
    let payload: OttoJSONValue
}
