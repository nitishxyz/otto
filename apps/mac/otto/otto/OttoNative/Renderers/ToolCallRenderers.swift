import SwiftUI

// Shared environment-style payload for every renderer.
struct OttoToolRendererContext {
    let toolName: String
    let contentJson: OttoJSONValue
    let durationMs: Int?
    let isExpanded: Binding<Bool>
}

// MARK: - Bash / shell

/// Mirrors `BashRenderer.tsx` — shows the command, exit code, and stdout/stderr.
struct OttoBashRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        let args = ctx.contentJson["args"]
        let result = ctx.contentJson["result"]
        let cmd = args?["cmd"]?.stringValue ?? ""
        let cwd = args?["cwd"]?.stringValue
        let stdout = result?["stdout"]?.stringValue ?? ""
        let stderr = result?["stderr"]?.stringValue ?? ""
        let exitCode = result?["exitCode"]?.intValue ?? 0
        let hasError = exitCode != 0 || (result?["ok"]?.boolValue == false)
        let durationText = OttoRendererUtil.formatDuration(ctx.durationMs)
        let combined = stdout + (stdout.isEmpty || stderr.isEmpty ? "" : "\n") + stderr

        VStack(alignment: .leading, spacing: 6) {
            OttoRendererHeader(
                toolName: "shell",
                symbolName: "terminal",
                color: .default,
                isError: hasError,
                isExpanded: ctx.isExpanded
            ) {
                HStack(spacing: 6) {
                    OttoRendererDot()
                    Text(cmd)
                    if let cwd, !cwd.isEmpty {
                        OttoRendererDot()
                        Text(cwd)
                            .foregroundStyle(.tertiary)
                    }
                    if let durationText {
                        OttoRendererDot()
                        Text(durationText)
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            if ctx.isExpanded.wrappedValue, !combined.isEmpty {
                OttoRendererContentBox {
                    OttoRendererMonoText(text: combined)
                }
            }
        }
    }
}

// MARK: - Read

/// Mirrors `ReadRenderer.tsx` — file path and (when expanded) file contents.
struct OttoReadRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        let path = ctx.contentJson["args"]?["path"]?.stringValue ?? ""
        let result = ctx.contentJson["result"]
        let content = result?["content"]?.stringValue ?? result?["text"]?.stringValue ?? ""
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false).count
        let hasError = result?["ok"]?.boolValue == false

        VStack(alignment: .leading, spacing: 6) {
            OttoRendererHeader(
                toolName: "read",
                symbolName: "doc.text",
                color: .blue,
                isError: hasError,
                isExpanded: ctx.isExpanded
            ) {
                HStack(spacing: 6) {
                    OttoRendererDot()
                    Text(OttoRendererUtil.basename(path))
                    if lines > 0 {
                        OttoRendererDot()
                        Text("\(lines) lines").foregroundStyle(.tertiary)
                    }
                }
            }

            if ctx.isExpanded.wrappedValue, !content.isEmpty {
                OttoRendererContentBox {
                    OttoRendererMonoText(text: content)
                }
            }
        }
    }
}

// MARK: - Write

/// Mirrors `WriteRenderer.tsx`.
struct OttoWriteRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        let args = ctx.contentJson["args"]
        let result = ctx.contentJson["result"]
        let path = args?["path"]?.stringValue ?? ""
        let content = args?["content"]?.stringValue ?? ""
        let bytes = result?["bytesWritten"]?.intValue ?? content.utf8.count
        let hasError = result?["ok"]?.boolValue == false

        VStack(alignment: .leading, spacing: 6) {
            OttoRendererHeader(
                toolName: "write",
                symbolName: "square.and.pencil",
                color: .emerald,
                isError: hasError,
                isExpanded: ctx.isExpanded
            ) {
                HStack(spacing: 6) {
                    OttoRendererDot()
                    Text(OttoRendererUtil.basename(path))
                    OttoRendererDot()
                    Text("\(bytes) bytes").foregroundStyle(.tertiary)
                }
            }

            if ctx.isExpanded.wrappedValue, !content.isEmpty {
                OttoRendererContentBox {
                    OttoRendererMonoText(text: content)
                }
            }
        }
    }
}

// MARK: - Apply patch / edit / multiedit

/// Mirrors `ApplyPatchRenderer.tsx` — file path and a simple line-prefixed diff view.
struct OttoApplyPatchRenderer: View {
    let ctx: OttoToolRendererContext

    var body: some View {
        let args = ctx.contentJson["args"]
        let result = ctx.contentJson["result"]
        let path = args?["path"]?.stringValue ?? args?["target"]?.stringValue ?? ""
        let patch = args?["patch"]?.stringValue ?? args?["diff"]?.stringValue ?? ""
        let summary = result?["summary"]?.stringValue
        let additions = result?["additions"]?.intValue
        let deletions = result?["deletions"]?.intValue
        let hasError = result?["ok"]?.boolValue == false

        VStack(alignment: .leading, spacing: 6) {
            OttoRendererHeader(
                toolName: ctx.toolName,
                symbolName: "doc.badge.gearshape",
                color: .purple,
                isError: hasError,
                isExpanded: ctx.isExpanded
            ) {
                HStack(spacing: 6) {
                    OttoRendererDot()
                    Text(OttoRendererUtil.basename(path))
                    if let additions {
                        OttoRendererDot()
                        Text("+\(additions)").foregroundStyle(Color.green)
                    }
                    if let deletions {
                        Text("-\(deletions)").foregroundStyle(Color.red)
                    }
                    if let summary {
                        OttoRendererDot()
                        Text(summary).foregroundStyle(.tertiary)
                    }
                }
            }

            if ctx.isExpanded.wrappedValue, !patch.isEmpty {
                OttoRendererContentBox {
                    diffView(for: patch)
                }
            }
        }
    }

    @ViewBuilder
    private func diffView(for patch: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(patch.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { _, line in
                let str = String(line)
                Text(str.isEmpty ? " " : str)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(color(for: str))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .textSelection(.enabled)
    }

    private func color(for line: String) -> Color {
        if line.hasPrefix("+++") || line.hasPrefix("---") { return .secondary }
        if line.hasPrefix("+") { return .green }
        if line.hasPrefix("-") { return .red }
        if line.hasPrefix("@@") { return Color.indigo }
        return Color.primary.opacity(0.9)
    }
}

// MARK: - List / Tree / Search

/// Mirrors `ListRenderer.tsx` (ls / tree / glob / grep / ripgrep results).
struct OttoListRenderer: View {
    let ctx: OttoToolRendererContext
    var symbolName: String = "list.bullet"
    var color: OttoRendererColor = .cyan

    var body: some View {
        let args = ctx.contentJson["args"]
        let result = ctx.contentJson["result"]
        let path = args?["path"]?.stringValue ?? args?["pattern"]?.stringValue ?? args?["query"]?.stringValue
        let entries: [String] = {
            if let raw = result?["entries"]?.arrayValue {
                return raw.compactMap(\.stringValue) + raw.compactMap { $0["name"]?.stringValue }
            }
            if let raw = result?["matches"]?.arrayValue {
                return raw.compactMap {
                    $0["file"]?.stringValue ?? $0.stringValue
                }
            }
            if let raw = result?["files"]?.arrayValue {
                return raw.compactMap(\.stringValue)
            }
            return []
        }()
        let hasError = result?["ok"]?.boolValue == false

        VStack(alignment: .leading, spacing: 6) {
            OttoRendererHeader(
                toolName: ctx.toolName,
                symbolName: symbolName,
                color: color,
                isError: hasError,
                isExpanded: ctx.isExpanded
            ) {
                HStack(spacing: 6) {
                    if let path, !path.isEmpty {
                        OttoRendererDot()
                        Text(path)
                    }
                    OttoRendererDot()
                    Text("\(entries.count) results").foregroundStyle(.tertiary)
                }
            }

            if ctx.isExpanded.wrappedValue, !entries.isEmpty {
                OttoRendererContentBox {
                    VStack(alignment: .leading, spacing: 1) {
                        ForEach(Array(entries.prefix(200).enumerated()), id: \.offset) { _, entry in
                            Text(entry)
                                .font(.system(size: 11, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        if entries.count > 200 {
                            Text("… \(entries.count - 200) more")
                                .font(.system(size: 11))
                                .foregroundStyle(.tertiary)
                                .padding(.top, 4)
                        }
                    }
                    .textSelection(.enabled)
                }
            }
        }
    }
}
