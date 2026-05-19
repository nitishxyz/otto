import Foundation

/// Mirrors `packages/web-sdk/src/lib/commands.ts` for the native composer.
struct OttoChatCommand: Identifiable, Hashable {
    let id: String
    let label: String
    let description: String
    let symbolName: String

    var matchesQuery: ((String) -> Bool)?

    func matches(_ query: String) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return true }
        return label.localizedCaseInsensitiveContains(trimmed) ||
            id.localizedCaseInsensitiveContains(trimmed)
    }

    static func == (lhs: OttoChatCommand, rhs: OttoChatCommand) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

enum OttoChatCommandCatalog {
    static let all: [OttoChatCommand] = [
        .init(id: "models", label: "/models", description: "Open model selector", symbolName: "sparkles"),
        .init(id: "agents", label: "/agents", description: "Open agent selector", symbolName: "terminal"),
        .init(id: "new", label: "/new", description: "Create new session", symbolName: "plus.circle"),
        .init(id: "stop", label: "/stop", description: "Stop current generation", symbolName: "stop.circle"),
        .init(id: "help", label: "/help", description: "Show keyboard shortcuts and help", symbolName: "keyboard"),
        .init(id: "reasoning", label: "/reasoning", description: "Toggle extended thinking", symbolName: "brain.head.profile"),
        .init(id: "share", label: "/share", description: "Share the current session", symbolName: "square.and.arrow.up"),
        .init(id: "compact", label: "/compact", description: "Compact the conversation", symbolName: "rectangle.compress.vertical"),
        .init(id: "stage", label: "/stage", description: "Stage changes in this session", symbolName: "tray.and.arrow.down"),
        .init(id: "branch", label: "/branch", description: "Branch from the latest message", symbolName: "arrow.triangle.branch"),
        .init(id: "clear", label: "/clear", description: "Clear the conversation", symbolName: "trash")
    ]

    /// Looks up a command whose label exactly matches `value` (case-insensitive).
    static func exact(matching value: String) -> OttoChatCommand? {
        let normalized = value.trimmingCharacters(in: .whitespaces).lowercased()
        return all.first { $0.label.lowercased() == normalized }
    }

    /// Commands whose label/id contain `query` (when query starts with `/`, the leading slash is stripped first).
    static func filtered(by query: String) -> [OttoChatCommand] {
        let stripped = query.hasPrefix("/") ? String(query.dropFirst()) : query
        return all.filter { $0.matches(stripped) }
    }
}
