import SwiftUI

// MARK: - Color variants (mirrors web-sdk renderers/shared/ToolHeader.tsx)

enum OttoRendererColor {
    case `default`, blue, emerald, purple, cyan, amber, red

    var tint: Color {
        switch self {
        case .default: return .secondary
        case .blue:    return Color(red: 0.40, green: 0.62, blue: 0.95)
        case .emerald: return Color(red: 0.30, green: 0.80, blue: 0.62)
        case .purple:  return Color(red: 0.72, green: 0.55, blue: 0.95)
        case .cyan:    return Color(red: 0.30, green: 0.78, blue: 0.85)
        case .amber:   return Color(red: 0.95, green: 0.74, blue: 0.30)
        case .red:     return Color(red: 0.95, green: 0.42, blue: 0.42)
        }
    }
}

// MARK: - Shared header

/// Single-line header used by every tool renderer.
/// Shows the tool name, an optional summary/badges, and an expand chevron.
struct OttoRendererHeader<Content: View>: View {
    let toolName: String
    let symbolName: String
    let color: OttoRendererColor
    let isError: Bool
    let canExpand: Bool
    @Binding var isExpanded: Bool
    let trailing: Content

    init(
        toolName: String,
        symbolName: String = "wrench.and.screwdriver",
        color: OttoRendererColor = .default,
        isError: Bool = false,
        canExpand: Bool = true,
        isExpanded: Binding<Bool>,
        @ViewBuilder trailing: () -> Content = { EmptyView() }
    ) {
        self.toolName = toolName
        self.symbolName = symbolName
        self.color = color
        self.isError = isError
        self.canExpand = canExpand
        self._isExpanded = isExpanded
        self.trailing = trailing()
    }

    var body: some View {
        Button(action: { if canExpand { isExpanded.toggle() } }) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: isError ? "exclamationmark.triangle.fill" : symbolName)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(isError ? Color.red : color.tint)
                    .frame(width: 14, alignment: .center)

                Text(toolName)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(isError ? Color.red : color.tint)

                trailing
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.secondary)

                Spacer(minLength: 0)

                if canExpand {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .pressableCursor()
    }
}

/// A faded subtle separator dot used between header segments.
struct OttoRendererDot: View {
    var body: some View {
        Text("·")
            .font(.system(size: 11))
            .foregroundStyle(.tertiary)
    }
}

// MARK: - Content box

/// Rounded gray block used to show a tool's expanded output.
struct OttoRendererContentBox<Content: View>: View {
    let content: Content
    var maxHeight: CGFloat? = 320

    init(maxHeight: CGFloat? = 320, @ViewBuilder content: () -> Content) {
        self.maxHeight = maxHeight
        self.content = content()
    }

    var body: some View {
        ScrollView {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
        }
        .frame(maxHeight: maxHeight)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.06), lineWidth: 0.5)
        )
    }
}

// MARK: - Monospaced text block

/// Multiline monospaced text used for shell output, file content, diffs.
struct OttoRendererMonoText: View {
    let text: String
    var fontSize: CGFloat = 11
    var lineSpacing: CGFloat = 2

    var body: some View {
        Text(text)
            .font(.system(size: fontSize, design: .monospaced))
            .lineSpacing(lineSpacing)
            .textSelection(.enabled)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Utility helpers

enum OttoRendererUtil {
    /// Format milliseconds as a compact duration string (`120ms`, `1.4s`, `2m 5s`).
    static func formatDuration(_ ms: Int?) -> String? {
        guard let ms, ms > 0 else { return nil }
        if ms < 1000 { return "\(ms)ms" }
        let seconds = Double(ms) / 1000
        if seconds < 60 { return String(format: "%.1fs", seconds) }
        let minutes = Int(seconds) / 60
        let remaining = Int(seconds) % 60
        return "\(minutes)m \(remaining)s"
    }

    /// Convenience: read a string value from an `OttoJSONValue` keypath like `"args.cmd"`.
    static func string(_ value: OttoJSONValue?, _ keys: String...) -> String? {
        var current = value
        for key in keys { current = current?[key] }
        return current?.stringValue
    }

    /// Convenience: read an int value from a key path.
    static func int(_ value: OttoJSONValue?, _ keys: String...) -> Int? {
        var current = value
        for key in keys { current = current?[key] }
        return current?.intValue
    }

    /// Convenience: read an array value from a key path.
    static func array(_ value: OttoJSONValue?, _ keys: String...) -> [OttoJSONValue]? {
        var current = value
        for key in keys { current = current?[key] }
        return current?.arrayValue
    }

    /// Last path component for a file path (with leading slash collapsed).
    static func basename(_ path: String) -> String {
        (path as NSString).lastPathComponent
    }
}
