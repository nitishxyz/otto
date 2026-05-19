import Foundation

/// Tools that should be visually collapsed into a "compact activity" strip
/// inside an assistant message. Mirrors `EXPLORATION_TOOL_NAMES` in
/// `packages/web-sdk/src/components/messages/compactActivity.ts`.
private let kCompactActivityTools: Set<String> = [
    "read", "ls", "tree", "ripgrep", "grep", "glob",
    "websearch", "skill",
    "query_sessions", "query_messages", "search_history",
    "get_session_context", "get_parent_session"
]

/// A single line that summarises one exploratory part.
struct OttoCompactActivityEntry: Identifiable, Hashable {
    let id: String
    let label: String
    let toolName: String?
    let fullText: String?
}

@MainActor
enum OttoCompactActivity {

    // MARK: - Predicate

    /// Should this part be folded into the compact-activity strip?
    static func isCompact(_ part: OttoMessagePart) -> Bool {
        if part.type == "reasoning" { return true }
        guard part.type == "tool_call" || part.type == "tool_result" else { return false }
        guard let name = part.toolName.map(canonical) else { return false }
        return kCompactActivityTools.contains(name)
    }

    // MARK: - Entry building

    /// Build deduplicated compact entries (tool_call replaced by its tool_result when present).
    /// Mirrors `buildCompactActivityEntries` in web-sdk/compactActivity.ts.
    static func buildEntries(from parts: [OttoMessagePart]) -> [OttoCompactActivityEntry] {
        // Map of toolCallId -> the latest tool_result for it.
        var latestResults: [String: OttoMessagePart] = [:]
        for part in parts where part.type == "tool_result" {
            if let cid = part.toolCallId { latestResults[cid] = part }
        }

        var seenIds = Set<String>()
        var entries: [OttoCompactActivityEntry] = []

        for part in parts where isCompact(part) {
            // If this is a tool_call and we have a tool_result for it, prefer the result.
            if part.type == "tool_call",
               let cid = part.toolCallId,
               let result = latestResults[cid] {
                if seenIds.insert(result.id).inserted, let entry = entry(for: result) {
                    entries.append(entry)
                }
                continue
            }
            if seenIds.insert(part.id).inserted, let entry = entry(for: part) {
                entries.append(entry)
            }
        }
        return entries
    }

    // MARK: - Single entry

    static func entry(for part: OttoMessagePart) -> OttoCompactActivityEntry? {
        if part.type == "reasoning" {
            let raw = (part.textContent ?? part.content).trimmingCharacters(in: .whitespacesAndNewlines)
            let line = stripMarkdown(firstMeaningfulLine(raw))
            return OttoCompactActivityEntry(
                id: part.id,
                label: line.isEmpty ? "Thinking through the approach" : truncate(line),
                toolName: "reasoning",
                fullText: raw.isEmpty ? nil : raw
            )
        }

        guard let raw = part.toolName else { return nil }
        let name = canonical(raw)
        guard kCompactActivityTools.contains(name) else { return nil }

        let args = part.contentJson?["args"]
        let result = part.contentJson?["result"]

        switch name {
        case "read":
            let path = result?["path"]?.stringValue ?? args?["path"]?.stringValue
            return OttoCompactActivityEntry(
                id: part.id,
                label: path.map { "Reading \(truncate($0))" } ?? "Reading file contents",
                toolName: name,
                fullText: path
            )
        case "ls", "tree":
            let path = args?["path"]?.stringValue ?? result?["path"]?.stringValue
            return OttoCompactActivityEntry(
                id: part.id,
                label: path.map { "Scanning \(truncate($0))" } ?? "Scanning the project",
                toolName: name,
                fullText: path
            )
        case "ripgrep", "grep", "glob":
            let query = args?["query"]?.stringValue
                ?? args?["pattern"]?.stringValue
                ?? args?["filePattern"]?.stringValue
            return OttoCompactActivityEntry(
                id: part.id,
                label: query.map { "Searching for \(truncate($0, max: 42))" } ?? "Searching code",
                toolName: name,
                fullText: query
            )
        case "websearch":
            let query = args?["query"]?.stringValue
            let url = args?["url"]?.stringValue ?? result?["url"]?.stringValue
            let label: String
            if let query { label = "Researching \(truncate(query, max: 42))" }
            else if let url { label = "Reviewing \(truncate(url, max: 42))" }
            else { label = "Researching references" }
            return OttoCompactActivityEntry(id: part.id, label: label, toolName: name, fullText: query ?? url)
        case "skill":
            let skill = args?["name"]?.stringValue
            return OttoCompactActivityEntry(
                id: part.id,
                label: skill.map { "Loading skill \(truncate($0, max: 36))" } ?? "Loading a skill",
                toolName: name,
                fullText: skill
            )
        default:
            return OttoCompactActivityEntry(
                id: part.id,
                label: "Reviewing prior context",
                toolName: name,
                fullText: nil
            )
        }
    }

    // MARK: - Helpers

    private static func canonical(_ name: String) -> String {
        OttoMessagePartView.canonicalName(name)
    }

    private static func truncate(_ value: String, max: Int = 56) -> String {
        if value.count <= max { return value }
        return value.prefix(max - 1) + "…"
    }

    private static func firstMeaningfulLine(_ value: String) -> String {
        for raw in value.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            if !trimmed.isEmpty { return trimmed }
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func stripMarkdown(_ value: String) -> String {
        var s = value
        if s.lowercased().hasPrefix("reasoning:") {
            s = String(s.dropFirst("reasoning:".count)).trimmingCharacters(in: .whitespaces)
        }
        // Drop leading bullet markers.
        for marker in ["- ", "* ", "+ "] where s.hasPrefix(marker) {
            s = String(s.dropFirst(marker.count))
        }
        // Strip markdown punctuation we don't want to show in a one-liner.
        let stripped = s.unicodeScalars.filter { scalar in
            !"*_`#>~".unicodeScalars.contains(scalar)
        }
        return String(String.UnicodeScalarView(stripped))
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespaces)
    }
}

// MARK: - Block grouping inside a message

/// A logical block inside an assistant message. Either a compact activity strip
/// (a contiguous run of exploratory parts collapsed into one row) or a single
/// "loud" part rendered with its full renderer.
enum OttoMessageBlock: Identifiable {
    case compact(id: String, entries: [OttoCompactActivityEntry])
    case part(OttoMessagePart)

    var id: String {
        switch self {
        case .compact(let id, _): return "compact-\(id)"
        case .part(let part):     return "part-\(part.id)"
        }
    }
}

enum OttoMessageBlocker {
    /// Group `parts` into blocks: contiguous compact parts collapse together,
    /// everything else stays solo. Order is preserved by `index`.
    static func makeBlocks(from parts: [OttoMessagePart]) -> [OttoMessageBlock] {
        let sorted = parts.sorted { $0.index < $1.index }
        var blocks: [OttoMessageBlock] = []
        var compactBuffer: [OttoMessagePart] = []

        func flush() {
            guard !compactBuffer.isEmpty else { return }
            let entries = OttoCompactActivity.buildEntries(from: compactBuffer)
            if !entries.isEmpty {
                let id = compactBuffer.first?.id ?? UUID().uuidString
                blocks.append(.compact(id: id, entries: entries))
            }
            compactBuffer.removeAll(keepingCapacity: true)
        }

        for part in sorted {
            if OttoCompactActivity.isCompact(part) {
                compactBuffer.append(part)
                continue
            }
            // Skip ephemeral tool_call dupes that have a tool_result later (handled by compact too)
            if part.type == "tool_call",
               let cid = part.toolCallId,
               sorted.contains(where: { $0.type == "tool_result" && $0.toolCallId == cid }) {
                continue
            }
            flush()
            blocks.append(.part(part))
        }
        flush()
        return blocks
    }
}
