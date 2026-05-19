import Combine
import Foundation

/// Real-time message stream coordinator for a single otto session.
///
/// Mirrors `packages/web-sdk/src/hooks/useSessionStream.ts`:
/// - subscribes to `/v1/sessions/{id}/stream` SSE
/// - merges deltas into an in-memory `[OttoMessage]` cache
/// - re-fetches the message list on `message.created` / `message.completed` / `error`
/// - keeps track of the currently-streaming assistant message so deltas land in the right place
///
/// Owned by `OttoNativeBlockViewModel`; UI consumers read `$messages` to render.
@MainActor
final class OttoSessionStream: ObservableObject {
    @Published private(set) var messages: [OttoMessage] = []
    @Published private(set) var isStreaming = false
    @Published private(set) var lastError: String?

    private let client: OttoAPIClient
    private let sseClient = OttoSSEClient()
    private var subscriptionTask: Task<Void, Never>?
    private var assistantMessageId: String?
    private var sessionId: String?

    init(client: OttoAPIClient) {
        self.client = client
    }

    deinit {
        subscriptionTask?.cancel()
        // Disconnect synchronously via the unstructured task; safe because SSE is actor-isolated.
        let sse = sseClient
        Task.detached { await sse.disconnect() }
    }

    // MARK: - Lifecycle

    /// Connect to the SSE stream for `sessionId` and load initial messages.
    func connect(sessionId: String) async {
        if self.sessionId == sessionId, isStreaming { return }
        await disconnect()
        self.sessionId = sessionId
        await loadMessages()
        await attachStream(sessionId: sessionId)
    }

    /// Reload the message list from the server (e.g. after a send completes).
    func reload() async {
        await loadMessages()
    }

    /// Stop the SSE stream and clear local state.
    func disconnect() async {
        subscriptionTask?.cancel()
        subscriptionTask = nil
        assistantMessageId = nil
        await sseClient.disconnect()
        isStreaming = false
    }

    // MARK: - Networking

    private func loadMessages() async {
        guard let sessionId else { return }
        do {
            messages = try await client.listMessages(sessionID: sessionId)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func attachStream(sessionId: String) async {
        guard let url = client.streamURL(sessionID: sessionId) else { return }
        await sseClient.connect(url: url)
        isStreaming = true

        // Fan all events into a serial async stream consumed on the main actor so we never race.
        let sseClient = self.sseClient
        let stream = AsyncStream<OttoSSEEvent> { continuation in
            let setup = Task {
                let subscription = await sseClient.on("*") { event in
                    continuation.yield(event)
                }
                return subscription
            }
            continuation.onTermination = { _ in
                Task {
                    let subscription = await setup.value
                    subscription.cancel()
                }
            }
        }

        subscriptionTask?.cancel()
        subscriptionTask = Task { @MainActor [weak self] in
            for await event in stream {
                guard let self else { return }
                self.handle(event: event)
            }
        }
    }

    // MARK: - Event handling

    private func handle(event: OttoSSEEvent) {
        switch event.type {
        case "message.created":
            handleMessageCreated(event.payload)
        case "message.part.delta", "message.delta":
            applyTextDelta(event.payload, type: "text")
        case "message.reasoning.delta", "reasoning.delta":
            applyTextDelta(event.payload, type: "reasoning")
        case "tool.call":
            upsertToolCall(event.payload, ephemeral: true)
        case "tool.delta":
            // Reserved for future incremental tool input/output deltas.
            break
        case "tool.result":
            upsertToolResult(event.payload)
        case "message.completed":
            Task { await self.loadMessages() }
            if assistantMessageId == (event.payload["messageId"]?.stringValue) {
                assistantMessageId = nil
            }
        case "error":
            lastError = event.payload["error"]?.stringValue ?? event.payload["message"]?.stringValue
        default:
            break
        }
    }

    private func handleMessageCreated(_ payload: OttoJSONValue) {
        let messageObject = payload["message"] ?? payload["data"] ?? payload
        if let role = messageObject["role"]?.stringValue, role == "assistant" {
            assistantMessageId = messageObject["id"]?.stringValue
        }
        Task { await self.loadMessages() }
    }

    private func applyTextDelta(_ payload: OttoJSONValue, type: String) {
        guard
            let messageId = payload["messageId"]?.stringValue,
            let partId = payload["partId"]?.stringValue,
            let delta = payload["delta"]?.stringValue
        else { return }

        let stepIndex = payload["stepIndex"]?.intValue
        mutateMessage(id: messageId) { message in
            var parts = message.parts ?? []
            if let idx = parts.firstIndex(where: { $0.id == partId }) {
                var existing = parts[idx]
                let previousText = existing.textContent ?? ""
                let nextText = previousText + delta
                existing.content = nextText
                existing.contentJson = .object(["text": .string(nextText)])
                if let stepIndex { existing.stepIndex = stepIndex }
                parts[idx] = existing
            } else {
                let newPart = OttoMessagePart(
                    id: partId,
                    messageId: messageId,
                    index: nextOptimisticIndex(for: parts, stepIndex: stepIndex),
                    stepIndex: stepIndex,
                    type: type,
                    content: delta,
                    contentJson: .object(["text": .string(delta)]),
                    agent: message.agent,
                    provider: message.provider,
                    model: message.model,
                    startedAt: Date().timeIntervalSince1970 * 1000,
                    completedAt: nil,
                    toolName: nil,
                    toolCallId: nil,
                    toolDurationMs: nil,
                    ephemeral: false
                )
                parts.append(newPart)
            }
            message.parts = parts
        }
    }

    private func upsertToolCall(_ payload: OttoJSONValue, ephemeral: Bool) {
        let callId = payload["callId"]?.stringValue ?? payload["toolCallId"]?.stringValue
        let name = payload["name"]?.stringValue ?? payload["toolName"]?.stringValue
        guard let name else { return }
        let stepIndex = payload["stepIndex"]?.intValue
        let explicitMessageId = payload["messageId"]?.stringValue

        let targetIndex = resolveAssistantIndex(explicitMessageId: explicitMessageId)
        guard targetIndex >= 0 else { return }

        var message = messages[targetIndex]
        var parts = message.parts ?? []

        let existingIndex: Int? = {
            if let callId, let idx = parts.firstIndex(where: { $0.toolCallId == callId }) {
                return idx
            }
            if callId == nil, let idx = parts.firstIndex(where: { $0.ephemeral == true && $0.toolName == name }) {
                return idx
            }
            return nil
        }()

        if let idx = existingIndex {
            var existing = parts[idx]
            existing.toolName = name
            if let callId { existing.toolCallId = callId }
            if let stepIndex { existing.stepIndex = stepIndex }
            existing.type = "tool_call"
            existing.ephemeral = ephemeral
            parts[idx] = existing
        } else {
            let part = OttoMessagePart(
                id: callId.map { "ephemeral-tool-call-\($0)" } ?? "ephemeral-tool-call-\(name)-\(Int(Date().timeIntervalSince1970 * 1000))",
                messageId: message.id,
                index: nextOptimisticIndex(for: parts, stepIndex: stepIndex),
                stepIndex: stepIndex,
                type: "tool_call",
                content: "",
                contentJson: makeToolCallContent(name: name, callId: callId, args: payload["args"] ?? payload["input"]),
                agent: message.agent,
                provider: message.provider,
                model: message.model,
                startedAt: Date().timeIntervalSince1970 * 1000,
                completedAt: nil,
                toolName: name,
                toolCallId: callId,
                toolDurationMs: nil,
                ephemeral: ephemeral
            )
            parts.append(part)
        }
        message.parts = parts
        messages[targetIndex] = message
    }

    private func upsertToolResult(_ payload: OttoJSONValue) {
        let callId = payload["callId"]?.stringValue ?? payload["toolCallId"]?.stringValue
        let name = payload["name"]?.stringValue ?? payload["toolName"]?.stringValue
        let durationMs = payload["durationMs"]?.intValue ?? payload["toolDurationMs"]?.intValue
        let explicitMessageId = payload["messageId"]?.stringValue

        let targetIndex = resolveAssistantIndex(explicitMessageId: explicitMessageId)
        guard targetIndex >= 0 else { return }

        var message = messages[targetIndex]
        var parts = message.parts ?? []

        let matchIndex: Int? = {
            if let callId, let idx = parts.firstIndex(where: { $0.toolCallId == callId }) {
                return idx
            }
            if let name, let idx = parts.firstIndex(where: { $0.toolName == name && $0.type == "tool_call" }) {
                return idx
            }
            return nil
        }()

        if let idx = matchIndex {
            var existing = parts[idx]
            existing.type = "tool_result"
            existing.completedAt = Date().timeIntervalSince1970 * 1000
            existing.toolDurationMs = durationMs ?? existing.toolDurationMs
            existing.ephemeral = false
            if let result = payload["result"] {
                existing.contentJson = mergeToolResult(into: existing.contentJson, result: result)
            }
            parts[idx] = existing
        }
        message.parts = parts
        messages[targetIndex] = message
    }

    // MARK: - Helpers

    private func resolveAssistantIndex(explicitMessageId: String?) -> Int {
        if let explicitMessageId, let idx = messages.firstIndex(where: { $0.id == explicitMessageId }) {
            return idx
        }
        if let assistantMessageId, let idx = messages.firstIndex(where: { $0.id == assistantMessageId }) {
            return idx
        }
        return messages.lastIndex(where: { $0.role == "assistant" && $0.status != "complete" }) ?? -1
    }

    private func nextOptimisticIndex(for parts: [OttoMessagePart], stepIndex: Int?) -> Int {
        let allMax = parts.map(\.index).max() ?? -1
        if let stepIndex {
            let stepMax = parts.filter { $0.stepIndex == stepIndex }.map(\.index).max()
            return (stepMax ?? allMax) + 1
        }
        return allMax + 1
    }

    private func makeToolCallContent(name: String, callId: String?, args: OttoJSONValue?) -> OttoJSONValue {
        var fields: [String: OttoJSONValue] = ["name": .string(name)]
        if let callId { fields["callId"] = .string(callId) }
        if let args { fields["args"] = args }
        return .object(fields)
    }

    private func mergeToolResult(into existing: OttoJSONValue?, result: OttoJSONValue) -> OttoJSONValue {
        var fields = existing?.objectValue ?? [:]
        fields["result"] = result
        return .object(fields)
    }

    private func mutateMessage(id: String, _ mutate: (inout OttoMessage) -> Void) {
        guard let idx = messages.firstIndex(where: { $0.id == id }) else { return }
        var message = messages[idx]
        mutate(&message)
        messages[idx] = message
    }
}
