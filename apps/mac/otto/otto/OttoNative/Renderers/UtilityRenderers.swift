import SwiftUI

// MARK: - Todos

/// Mirrors `TodosRenderer.tsx` — checklist of todo items.
struct OttoTodosRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        let items = todoItems()
        let pending = items.filter { $0.status == "pending" }.count
        let inProgress = items.filter { $0.status == "in_progress" }.count
        let completed = items.filter { $0.status == "completed" }.count
        let total = items.count

        VStack(alignment: .leading, spacing: 6) {
            OttoRendererHeader(
                toolName: "update_todos",
                symbolName: "checklist",
                color: .purple,
                isExpanded: ctx.isExpanded
            ) {
                HStack(spacing: 6) {
                    OttoRendererDot()
                    Text("\(completed)/\(total) done").foregroundStyle(Color.green)
                    if inProgress > 0 {
                        OttoRendererDot()
                        Text("\(inProgress) active").foregroundStyle(Color.orange)
                    }
                    if pending > 0 {
                        OttoRendererDot()
                        Text("\(pending) pending").foregroundStyle(.tertiary)
                    }
                }
            }

            if ctx.isExpanded.wrappedValue, !items.isEmpty {
                OttoRendererContentBox(maxHeight: 280) {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Image(systemName: icon(for: item.status))
                                    .foregroundStyle(tint(for: item.status))
                                    .font(.system(size: 11, weight: .semibold))
                                    .frame(width: 14)
                                Text(item.step)
                                    .font(.system(size: 12))
                                    .strikethrough(item.status == "completed" || item.status == "cancelled", color: .secondary)
                                    .foregroundStyle(item.status == "completed" ? .secondary : .primary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
            }
        }
    }

    private struct TodoItem { let step: String; let status: String }

    private func todoItems() -> [TodoItem] {
        let args = ctx.contentJson["args"]
        let raw = args?["todos"]?.arrayValue ?? ctx.contentJson["result"]?["items"]?.arrayValue ?? []
        return raw.compactMap { value in
            if let step = value["step"]?.stringValue {
                return TodoItem(step: step, status: value["status"]?.stringValue ?? "pending")
            }
            if let step = value.stringValue {
                return TodoItem(step: step, status: "pending")
            }
            return nil
        }
    }

    private func icon(for status: String) -> String {
        switch status {
        case "completed":   return "checkmark.circle.fill"
        case "in_progress": return "circle.dashed"
        case "cancelled":   return "xmark.circle"
        default:            return "circle"
        }
    }

    private func tint(for status: String) -> Color {
        switch status {
        case "completed":   return .green
        case "in_progress": return .orange
        case "cancelled":   return .gray
        default:            return Color.primary.opacity(0.4)
        }
    }
}

// MARK: - Progress update

/// Mirrors `ProgressUpdateRenderer.tsx` — short status line, no expansion.
struct OttoProgressUpdateRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        let args = ctx.contentJson["args"]
        let message = args?["message"]?.stringValue ?? ""
        let pct = args?["pct"]?.intValue
        let stage = args?["stage"]?.stringValue

        HStack(spacing: 6) {
            Image(systemName: "hourglass")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.cyan)
            if let stage {
                Text(stage.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.tertiary)
                OttoRendererDot()
            }
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .lineLimit(2)
            if let pct {
                Spacer(minLength: 6)
                Text("\(pct)%")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

// MARK: - Finish

/// Mirrors `FinishRenderer.tsx` — turn complete sentinel.
struct OttoFinishRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.green)
            Text("turn complete")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.green)
            if let summary = ctx.contentJson["args"]?["summary"]?.stringValue, !summary.isEmpty {
                OttoRendererDot()
                Text(summary)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Generic fallback

/// Default renderer for tools we don't have a specialized view for.
struct OttoGenericToolRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        let durationText = OttoRendererUtil.formatDuration(ctx.durationMs)
        let hasError = ctx.contentJson["result"]?["ok"]?.boolValue == false

        VStack(alignment: .leading, spacing: 6) {
            OttoRendererHeader(
                toolName: ctx.toolName,
                symbolName: "hammer",
                color: .default,
                isError: hasError,
                isExpanded: ctx.isExpanded
            ) {
                if let durationText {
                    HStack(spacing: 6) {
                        OttoRendererDot()
                        Text(durationText).foregroundStyle(.tertiary)
                    }
                }
            }

            if ctx.isExpanded.wrappedValue {
                OttoRendererContentBox {
                    OttoRendererMonoText(text: pretty(ctx.contentJson))
                }
            }
        }
    }

    private func pretty(_ value: OttoJSONValue) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(value), let str = String(data: data, encoding: .utf8) {
            return str
        }
        return ""
    }
}

// MARK: - Error part

/// Mirrors `ErrorRenderer.tsx`'s primary failure card (no retry/compact buttons yet).
struct OttoErrorPartView: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.red)
                .font(.system(size: 12, weight: .semibold))
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(Color.red)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.red.opacity(0.30), lineWidth: 0.5)
        )
    }
}
