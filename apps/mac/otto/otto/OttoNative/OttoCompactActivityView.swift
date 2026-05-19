import SwiftUI

/// Compact, animated single-row strip that summarises a run of exploratory
/// tool calls / reasoning ("Reading …", "Searching for …", "Thinking …").
///
/// Mirrors `packages/web-sdk/src/components/messages/CompactActivityGroup.tsx`.
/// Tap to expand the full list of entries.
struct OttoCompactActivityStripView: View {
    let entries: [OttoCompactActivityEntry]
    var isStreaming: Bool = false

    @State private var isExpanded: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Collapsed header: shows the latest entry, with monospaced text so
            // it visually echoes the CLI transcript style of the surrounding
            // tool-call rows.
            Button(action: { withAnimation(.smooth(duration: 0.22)) { isExpanded.toggle() } }) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    icon
                    label
                    Spacer(minLength: 6)
                    if entries.count > 1 {
                        Text("\(entries.count)")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Color.primary.opacity(0.08), in: Capsule())
                    }
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .pressableCursor()

            if isExpanded {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(entries) { entry in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Image(systemName: symbol(for: entry.toolName))
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(.tertiary)
                                .frame(width: 14, alignment: .center)
                            Text(entry.label)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .padding(.leading, 22)
                .padding(.top, 2)
                .padding(.bottom, 2)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.06), lineWidth: 0.5)
        )
    }

    // MARK: - Subviews

    @ViewBuilder
    private var icon: some View {
        if isStreaming {
            // A subtle pulsing dot indicates the strip is currently being updated.
            Circle()
                .fill(Color.accentColor)
                .frame(width: 6, height: 6)
                .modifier(OttoStreamingPulse())
                .frame(width: 14, alignment: .center)
        } else {
            Image(systemName: symbol(for: latestEntry.toolName))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 14, alignment: .center)
        }
    }

    private var label: some View {
        Text(latestEntry.label)
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.tail)
            .id(latestEntry.id)
            .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private var latestEntry: OttoCompactActivityEntry {
        entries.last ?? OttoCompactActivityEntry(id: "empty", label: "Working", toolName: nil, fullText: nil)
    }

    private func symbol(for tool: String?) -> String {
        switch tool {
        case "reasoning":         return "brain.head.profile"
        case "read":              return "doc.text"
        case "ls", "tree":        return "folder"
        case "ripgrep", "grep", "glob": return "magnifyingglass"
        case "websearch":         return "globe"
        case "skill":             return "sparkles"
        default:                  return "ellipsis.circle"
        }
    }
}

/// A subtle 1.4s pulsing scale animation used on the streaming dot.
struct OttoStreamingPulse: ViewModifier {
    @State private var pulse = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(pulse ? 1.25 : 0.9)
            .opacity(pulse ? 1.0 : 0.55)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
    }
}
