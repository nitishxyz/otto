import SwiftUI

// MARK: - git status

/// Mirrors `GitStatusRenderer.tsx` — summary counts plus per-file list.
struct OttoGitStatusRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        let result = ctx.contentJson["result"]
        let staged = result?["staged"]?.intValue ?? 0
        let unstaged = result?["unstaged"]?.intValue ?? 0
        let entries: [OttoJSONValue] = result?["raw"]?.arrayValue ?? result?["files"]?.arrayValue ?? []
        let hasError = result?["ok"]?.boolValue == false

        VStack(alignment: .leading, spacing: 6) {
            OttoRendererHeader(
                toolName: "git status",
                symbolName: "arrow.triangle.branch",
                color: .amber,
                isError: hasError,
                isExpanded: ctx.isExpanded
            ) {
                HStack(spacing: 6) {
                    OttoRendererDot()
                    Text("\(staged) staged").foregroundStyle(Color.green)
                    OttoRendererDot()
                    Text("\(unstaged) unstaged").foregroundStyle(Color.orange)
                }
            }

            if ctx.isExpanded.wrappedValue, !entries.isEmpty {
                OttoRendererContentBox {
                    VStack(alignment: .leading, spacing: 1) {
                        ForEach(Array(entries.prefix(200).enumerated()), id: \.offset) { _, entry in
                            Text(entry.stringValue ?? "")
                                .font(.system(size: 11, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .textSelection(.enabled)
                }
            }
        }
    }
}

// MARK: - git diff

/// Mirrors `GitDiffRenderer.tsx` — a unified diff with line coloring.
struct OttoGitDiffRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        let result = ctx.contentJson["result"]
        let diff = result?["diff"]?.stringValue ?? result?["patch"]?.stringValue ?? ""
        let additions = result?["additions"]?.intValue
        let deletions = result?["deletions"]?.intValue
        let filesChanged = result?["filesChanged"]?.intValue ?? result?["files"]?.arrayValue?.count
        let hasError = result?["ok"]?.boolValue == false

        VStack(alignment: .leading, spacing: 6) {
            OttoRendererHeader(
                toolName: "git diff",
                symbolName: "arrow.left.arrow.right.square",
                color: .amber,
                isError: hasError,
                isExpanded: ctx.isExpanded
            ) {
                HStack(spacing: 6) {
                    if let filesChanged {
                        OttoRendererDot()
                        Text("\(filesChanged) files").foregroundStyle(.tertiary)
                    }
                    if let additions {
                        OttoRendererDot()
                        Text("+\(additions)").foregroundStyle(Color.green)
                    }
                    if let deletions {
                        Text("-\(deletions)").foregroundStyle(Color.red)
                    }
                }
            }

            if ctx.isExpanded.wrappedValue, !diff.isEmpty {
                OttoRendererContentBox {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(diff.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { _, line in
                            let str = String(line)
                            Text(str.isEmpty ? " " : str)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(color(for: str))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .textSelection(.enabled)
                }
            }
        }
    }

    private func color(for line: String) -> Color {
        if line.hasPrefix("+++") || line.hasPrefix("---") { return .secondary }
        if line.hasPrefix("+") { return .green }
        if line.hasPrefix("-") { return .red }
        if line.hasPrefix("@@") { return Color.indigo }
        return Color.primary.opacity(0.9)
    }
}

// MARK: - git commit

/// Mirrors `GitCommitRenderer.tsx`.
struct OttoGitCommitRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        let args = ctx.contentJson["args"]
        let result = ctx.contentJson["result"]
        let message = args?["message"]?.stringValue ?? ""
        let hash = result?["hash"]?.stringValue
        let hasError = result?["ok"]?.boolValue == false

        VStack(alignment: .leading, spacing: 6) {
            OttoRendererHeader(
                toolName: "git commit",
                symbolName: "checkmark.seal",
                color: .amber,
                isError: hasError,
                isExpanded: ctx.isExpanded
            ) {
                HStack(spacing: 6) {
                    OttoRendererDot()
                    if let hash, !hash.isEmpty {
                        Text(String(hash.prefix(7))).foregroundStyle(.tertiary)
                        OttoRendererDot()
                    }
                    Text(message)
                        .lineLimit(1)
                }
            }

            if ctx.isExpanded.wrappedValue, !message.isEmpty {
                OttoRendererContentBox(maxHeight: 200) {
                    Text(message)
                        .font(.system(size: 12, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
            }
        }
    }
}
