import SwiftUI

/// Top-level dispatcher for a single `OttoMessagePart`.
///
/// Mirrors `packages/web-sdk/src/components/messages/renderers/index.tsx` —
/// routes by `part.type` first, then by canonical tool name.
struct OttoMessagePartView: View {
    let part: OttoMessagePart
    @State private var isExpanded: Bool = false

    var body: some View {
        switch part.type {
        case "text":
            OttoTextPartView(text: part.textContent ?? part.content)

        case "reasoning":
            OttoReasoningPartView(text: part.textContent ?? part.content)

        case "tool_call":
            inFlightToolView

        case "tool_result":
            renderTool()

        case "error":
            OttoErrorPartView(message: part.textContent ?? part.content)

        case "image":
            imagePart

        case "file":
            filePart

        default:
            OttoTextPartView(text: part.textContent ?? part.content)
        }
    }

    // MARK: - In-flight tool (pre-result)

    private var inFlightToolView: some View {
        HStack(spacing: 6) {
            ProgressView()
                .controlSize(.mini)
            Text(part.toolLabel)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
            if let cmd = OttoRendererUtil.string(part.contentJson, "args", "cmd") {
                OttoRendererDot()
                Text(cmd)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            } else if let path = OttoRendererUtil.string(part.contentJson, "args", "path") {
                OttoRendererDot()
                Text(OttoRendererUtil.basename(path))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.white.opacity(0.05), lineWidth: 0.5)
        )
    }

    // MARK: - Tool result router

    @ViewBuilder
    private func renderTool() -> some View {
        let ctx = OttoToolRendererContext(
            toolName: part.toolName ?? part.type,
            contentJson: part.contentJson ?? .object([:]),
            durationMs: part.toolDurationMs,
            isExpanded: $isExpanded
        )
        let canonical = OttoMessagePartView.canonicalName(part.toolName ?? part.type)

        switch canonical {
        case "shell":
            OttoBashRenderer(ctx: ctx)
        case "read":
            OttoReadRenderer(ctx: ctx)
        case "write":
            OttoWriteRenderer(ctx: ctx)
        case "edit", "multiedit", "copy_into", "apply_patch":
            OttoApplyPatchRenderer(ctx: ctx)
        case "ls":
            OttoListRenderer(ctx: ctx, symbolName: "folder", color: .cyan)
        case "tree":
            OttoListRenderer(ctx: ctx, symbolName: "tree", color: .cyan)
        case "ripgrep", "grep", "glob":
            OttoListRenderer(ctx: ctx, symbolName: "magnifyingglass", color: .cyan)
        case "git_status":
            OttoGitStatusRenderer(ctx: ctx)
        case "git_diff":
            OttoGitDiffRenderer(ctx: ctx)
        case "git_commit":
            OttoGitCommitRenderer(ctx: ctx)
        case "update_todos", "update_plan":
            OttoTodosRenderer(ctx: ctx)
        case "progress_update":
            OttoProgressUpdateRenderer(ctx: ctx)
        case "finish":
            OttoFinishRenderer(ctx: ctx)
        default:
            OttoGenericToolRenderer(ctx: ctx)
        }
    }

    // MARK: - Image / File parts

    @ViewBuilder
    private var imagePart: some View {
        if let url = OttoRendererUtil.string(part.contentJson, "url") ?? OttoRendererUtil.string(part.contentJson, "data"),
           let parsed = URL(string: url) {
            AsyncImage(url: parsed) { phase in
                switch phase {
                case .empty:    ProgressView().controlSize(.small)
                case .failure:  Image(systemName: "photo.badge.exclamationmark").foregroundStyle(.secondary)
                case .success(let image):
                    image.resizable()
                        .scaledToFit()
                        .frame(maxWidth: 280, maxHeight: 280)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                @unknown default: EmptyView()
                }
            }
        } else {
            HStack(spacing: 6) {
                Image(systemName: "photo").foregroundStyle(.secondary)
                Text(OttoRendererUtil.string(part.contentJson, "name") ?? "image")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var filePart: some View {
        HStack(spacing: 6) {
            Image(systemName: "doc.text.fill").foregroundStyle(.secondary)
            Text(OttoRendererUtil.string(part.contentJson, "name") ?? part.toolLabel)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Tool name normalization

    /// Mirrors `TOOL_NAME_ALIASES` from `web-sdk/components/messages/renderers/index.tsx`.
    nonisolated static func canonicalName(_ name: String) -> String {
        switch name {
        case "Read":          return "read"
        case "Edit":          return "edit"
        case "MultiEdit":     return "multiedit"
        case "Write":         return "write"
        case "CopyInto":      return "copy_into"
        case "Ls":            return "ls"
        case "Tree":          return "tree"
        case "Cd":            return "cd"
        case "Pwd":           return "pwd"
        case "Glob":          return "glob"
        case "Grep":          return "ripgrep"
        case "Shell", "Bash", "bash": return "shell"
        case "Terminal":      return "terminal"
        case "GitStatus":     return "git_status"
        case "GitDiff":       return "git_diff"
        case "GitCommit":     return "git_commit"
        case "ApplyPatch":    return "apply_patch"
        case "UpdateTodos", "UpdatePlan": return "update_todos"
        case "ProgressUpdate": return "progress_update"
        case "Finish":        return "finish"
        case "WebSearch":     return "websearch"
        case "LoadMcpTools":  return "load_mcp_tools"
        case "Skill":         return "skill"
        default:              return name
        }
    }
}
