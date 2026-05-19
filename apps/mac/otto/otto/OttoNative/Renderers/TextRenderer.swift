import SwiftUI

/// Renders a `text` part. We pre-strip Markdown to attributed text so links
/// stay clickable and inline code renders monospaced — without pulling in a
/// full Markdown engine.
struct OttoTextPartView: View {
    let text: String
    var isUser: Bool = false

    var body: some View {
        Text(attributed)
            .font(.system(size: 13))
            .textSelection(.enabled)
            .lineSpacing(3)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var attributed: AttributedString {
        // SwiftUI's built-in Markdown parser handles bold, italic, code, links.
        // We fall back to the raw text if parsing fails (shouldn't happen).
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

/// Renders a `reasoning` part with collapsible expansion.
/// Mirrors `packages/web-sdk/src/components/messages/renderers/ReasoningRenderer.tsx`.
struct OttoReasoningPartView: View {
    let text: String
    @State private var isExpanded: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: { isExpanded.toggle() }) {
                HStack(spacing: 6) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.indigo)
                    Text("Thinking")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.indigo)
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.tertiary)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .pressableCursor()

            if isExpanded {
                Text(text)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Color.indigo.opacity(0.18), lineWidth: 0.5)
                    )
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.snappy(duration: 0.18, extraBounce: 0.04), value: isExpanded)
    }
}
