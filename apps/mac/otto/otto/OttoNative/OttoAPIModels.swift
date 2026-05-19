import Foundation

nonisolated enum OttoJSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: OttoJSONValue])
    case array([OttoJSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: OttoJSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([OttoJSONValue].self) {
            self = .array(value)
        } else {
            self = .null
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case .bool(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        }
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var doubleValue: Double? {
        if case .number(let value) = self { return value }
        return nil
    }

    var intValue: Int? {
        if case .number(let value) = self { return Int(value) }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    var objectValue: [String: OttoJSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }

    var arrayValue: [OttoJSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }

    subscript(key: String) -> OttoJSONValue? {
        guard case .object(let object) = self else { return nil }
        return object[key]
    }
}

struct OttoSessionListResponse: Decodable {
    var items: [OttoSession]
    var hasMore: Bool
    var nextOffset: Int?
}

struct OttoSession: Decodable, Identifiable, Hashable {
    var id: String
    var title: String?
    var agent: String
    var provider: String
    var model: String
    var projectPath: String
    var createdAt: Double
    var lastActiveAt: Double?
    var totalInputTokens: Int?
    var totalOutputTokens: Int?
    var totalToolTimeMs: Int?
    var currentContextTokens: Int?
    var isRunning: Bool?

    var displayTitle: String {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "Untitled session" : trimmed
    }

    var displayModel: String {
        if model.isEmpty { return provider }
        return "\(provider) · \(model)"
    }

    var activityTimestamp: Double {
        lastActiveAt ?? createdAt
    }
}

struct OttoMessage: Decodable, Identifiable, Hashable {
    var id: String
    var sessionId: String
    var role: String
    var status: String
    var agent: String
    var provider: String
    var model: String
    var createdAt: Double
    var completedAt: Double?
    var latencyMs: Int?
    var inputTokens: Int?
    var outputTokens: Int?
    var totalTokens: Int?
    var error: String?
    var parts: [OttoMessagePart]?

    var isUser: Bool { role == "user" }
    var isAssistant: Bool { role == "assistant" }
    var isPending: Bool { status == "pending" }
}

struct OttoMessagePart: Codable, Identifiable, Hashable {
    var id: String
    var messageId: String
    var index: Int
    var stepIndex: Int?
    var type: String
    var content: String
    var contentJson: OttoJSONValue?
    var agent: String
    var provider: String
    var model: String
    var startedAt: Double?
    var completedAt: Double?
    var toolName: String?
    var toolCallId: String?
    var toolDurationMs: Int?
    var ephemeral: Bool?

    init(
        id: String,
        messageId: String,
        index: Int,
        stepIndex: Int? = nil,
        type: String,
        content: String,
        contentJson: OttoJSONValue? = nil,
        agent: String,
        provider: String,
        model: String,
        startedAt: Double? = nil,
        completedAt: Double? = nil,
        toolName: String? = nil,
        toolCallId: String? = nil,
        toolDurationMs: Int? = nil,
        ephemeral: Bool? = nil
    ) {
        self.id = id
        self.messageId = messageId
        self.index = index
        self.stepIndex = stepIndex
        self.type = type
        self.content = content
        self.contentJson = contentJson
        self.agent = agent
        self.provider = provider
        self.model = model
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.toolName = toolName
        self.toolCallId = toolCallId
        self.toolDurationMs = toolDurationMs
        self.ephemeral = ephemeral
    }

    var textContent: String? {
        if let value = contentJson?["text"]?.stringValue {
            return value
        }
        if case .string(let value) = contentJson {
            return value
        }
        guard let data = content.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return content.isEmpty ? nil : content
        }
        if let text = object["text"] as? String {
            return text
        }
        return content.isEmpty ? nil : content
    }

    var toolLabel: String {
        toolName ?? type.replacingOccurrences(of: "_", with: " ")
    }
}

struct OttoSendMessageResponse: Decodable {
    var messageId: String
}
