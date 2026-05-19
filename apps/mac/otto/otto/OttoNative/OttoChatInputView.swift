import AppKit
import SwiftUI

// MARK: - Public model

/// A file attached to the composer (image or document).
struct OttoChatAttachment: Identifiable, Hashable {
    enum Kind: Hashable { case image, pdf, text }

    let id: UUID
    let kind: Kind
    let name: String
    /// Local file URL or in-memory image data for previews.
    let previewImage: NSImage?

    init(id: UUID = UUID(), kind: Kind, name: String, previewImage: NSImage? = nil) {
        self.id = id
        self.kind = kind
        self.name = name
        self.previewImage = previewImage
    }
}

/// File mention candidate displayed in the `@` popup.
struct OttoChatMentionFile: Identifiable, Hashable {
    let id: String
    let path: String
    let name: String
    let isChanged: Bool

    init(path: String, isChanged: Bool = false) {
        self.id = path
        self.path = path
        self.name = (path as NSString).lastPathComponent
        self.isChanged = isChanged
    }
}

// MARK: - View

/// otto's native composer. Mirrors the surface of
/// `packages/web-sdk/src/components/chat/ChatInput.tsx` with the macOS-specific
/// affordances we get from `NSTextView` (real selection, undo, paste hooks).
struct OttoChatInputView: View {
    // Bindings to the parent's draft state
    @Binding var text: String
    @Binding var attachments: [OttoChatAttachment]
    @Binding var isPlanMode: Bool

    var disabled: Bool = false
    var isSending: Bool = false
    var placeholder: String = "Type a message…"
    var providerName: String?
    var modelName: String?
    var agent: String?
    var agents: [String] = []
    var reasoningEnabled: Bool = false
    var visionEnabled: Bool = false
    var attachmentEnabled: Bool = false

    /// Files used to populate the `@` mention popup. Parent supplies via callback.
    var mentionFiles: [OttoChatMentionFile] = []

    var onSend: () -> Void
    var onCommand: ((OttoChatCommand) -> Void)? = nil
    var onRemoveAttachment: ((OttoChatAttachment) -> Void)? = nil
    var onAgentChange: ((String) -> Void)? = nil
    var onPaste: ((NSPasteboard) -> Bool)? = nil

    @State private var selection: NSRange = NSRange(location: 0, length: 0)
    @State private var measuredHeight: CGFloat = 36
    @State private var showCommandPopup = false
    @State private var commandQuery = ""
    @State private var commandSelectedIndex = 0
    @State private var showMentionPopup = false
    @State private var mentionQuery = ""
    @State private var mentionRange: NSRange?
    @State private var mentionSelectedIndex = 0
    @FocusState private var fieldIsFocused: Bool

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Attachment chips
            if !attachments.isEmpty {
                attachmentChips
            }

            // Composer card
            composerSurface

            // Footer (agent · model · reasoning · vision · plan)
            footer
        }
        .background(alignment: .bottom) {
            // Popups sit above the composer.
            popups
                .offset(y: -measuredHeight - 60)
        }
        .onChange(of: text) { _, newValue in
            recomputeCommandPopup(text: newValue)
            recomputeMentionPopup(text: newValue, selection: selection)
        }
        .onChange(of: selection.location) { _, _ in
            recomputeMentionPopup(text: text, selection: selection)
        }
    }

    // MARK: - Sub views

    private var attachmentChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(attachments) { attachment in
                    OttoChatAttachmentChip(attachment: attachment) {
                        onRemoveAttachment?(attachment)
                    }
                }
            }
            .padding(.horizontal, 2)
        }
        .frame(maxHeight: 56)
    }

    private var composerSurface: some View {
        HStack(alignment: .bottom, spacing: 8) {
            // Text editor area
            OttoNativeTextEditor(
                text: $text,
                selection: $selection,
                measuredHeight: $measuredHeight,
                placeholder: isPlanMode ? "Plan mode — type a message…" : placeholder,
                font: .systemFont(ofSize: 13),
                minHeight: 22,
                maxHeight: 200,
                isFocused: fieldIsFocused,
                onKeyDown: handleKeyDown,
                onPaste: onPaste,
                onSubmit: submit
            )
            .frame(height: measuredHeight)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 6)

            // Send button
            sendButton
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        .background(composerBackground)
        .overlay(composerStroke)
        .focusable()
        .focused($fieldIsFocused)
        .onAppear { fieldIsFocused = true }
    }

    private var sendButton: some View {
        Button(action: submit) {
            Image(systemName: isSending ? "stop.fill" : "arrow.up")
                .font(.system(size: 12, weight: .bold))
                .frame(width: 28, height: 28)
                .foregroundStyle(canSend ? Color.white : Color.primary.opacity(0.4))
                .background(
                    Circle().fill(canSend ? Color.accentColor : Color.primary.opacity(0.08))
                )
        }
        .buttonStyle(.plain)
        .keyboardShortcut(.return, modifiers: [.command])
        .disabled(!canSend || disabled)
        .help("Send message (⌘↩)")
        .pressableCursor()
    }

    @ViewBuilder
    private var composerBackground: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(.regularMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.white.opacity(isPlanMode ? 0.03 : 0.05))
            )
    }

    private var composerStroke: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .stroke(
                fieldIsFocused
                    ? Color.accentColor.opacity(0.45)
                    : Color.white.opacity(0.10),
                lineWidth: 1
            )
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if let agent {
                agentChip(agent: agent)
            }
            Spacer(minLength: 0)
            modelBadge
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                if reasoningEnabled {
                    Label("reasoning", systemImage: "brain.head.profile")
                        .labelStyle(.titleAndIcon)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Color.indigo)
                }
                if visionEnabled {
                    Label("vision", systemImage: "photo")
                        .labelStyle(.titleAndIcon)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Color.green)
                }
                planToggle
            }
        }
        .padding(.horizontal, 4)
    }

    private func agentChip(agent: String) -> some View {
        Menu {
            ForEach(agents, id: \.self) { name in
                Button {
                    onAgentChange?(name)
                } label: {
                    HStack {
                        Text(name)
                        if name == agent { Image(systemName: "checkmark") }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(agent.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                Image(systemName: "chevron.up")
                    .font(.system(size: 8, weight: .bold))
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(Color.primary.opacity(0.05)))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    @ViewBuilder
    private var modelBadge: some View {
        if providerName != nil || modelName != nil {
            HStack(spacing: 4) {
                if let providerName {
                    Text(providerName)
                        .opacity(0.7)
                    Text("/").opacity(0.4)
                }
                if let modelName {
                    Text(modelName)
                }
            }
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.secondary)
        }
    }

    private var planToggle: some View {
        Toggle(isOn: $isPlanMode) {
            Label("plan", systemImage: isPlanMode ? "checkmark.seal.fill" : "checkmark.seal")
                .labelStyle(.titleAndIcon)
                .font(.system(size: 10, weight: .medium))
        }
        .toggleStyle(.button)
        .controlSize(.mini)
        .tint(isPlanMode ? Color.accentColor : Color.primary.opacity(0.3))
    }

    @ViewBuilder
    private var popups: some View {
        VStack(spacing: 6) {
            if showCommandPopup {
                OttoChatCommandPopup(
                    query: commandQuery,
                    selectedIndex: $commandSelectedIndex
                ) { command in
                    insertCommand(command)
                }
            }
            if showMentionPopup, !mentionFiles.isEmpty {
                OttoChatMentionPopup(
                    files: filteredMentionFiles,
                    selectedIndex: $mentionSelectedIndex
                ) { file in
                    insertMention(file: file)
                }
            }
        }
        .padding(.horizontal, 2)
    }

    // MARK: - Behavior

    private var canSend: Bool {
        !disabled && (
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
        )
    }

    private func submit() {
        guard canSend else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let exact = OttoChatCommandCatalog.exact(matching: trimmed) {
            onCommand?(exact)
            text = ""
            showCommandPopup = false
            return
        }
        onSend()
    }

    private func recomputeCommandPopup(text: String) {
        let trimmed = text
        if trimmed.hasPrefix("/"), !trimmed.contains(" "), !trimmed.contains("\n") {
            commandQuery = trimmed
            commandSelectedIndex = 0
            showCommandPopup = true
            showMentionPopup = false
        } else {
            showCommandPopup = false
        }
    }

    private func recomputeMentionPopup(text: String, selection: NSRange) {
        guard !text.hasPrefix("/") else {
            showMentionPopup = false
            return
        }
        // Find the most recent `@` before the cursor with no whitespace after it.
        let cursor = min(selection.location, text.count)
        let prefix = String(text.prefix(cursor))
        if let atRange = prefix.range(of: "@", options: .backwards) {
            let after = prefix[atRange.upperBound...]
            if after.contains(where: { $0 == " " || $0 == "\n" }) {
                showMentionPopup = false
                return
            }
            mentionQuery = String(after)
            mentionRange = NSRange(
                location: prefix.distance(from: prefix.startIndex, to: atRange.lowerBound),
                length: prefix.distance(from: atRange.lowerBound, to: prefix.endIndex)
            )
            mentionSelectedIndex = 0
            showMentionPopup = !mentionFiles.isEmpty
        } else {
            showMentionPopup = false
        }
    }

    private var filteredMentionFiles: [OttoChatMentionFile] {
        let q = mentionQuery.trimmingCharacters(in: .whitespaces)
        if q.isEmpty { return Array(mentionFiles.prefix(40)) }
        return mentionFiles.filter {
            $0.path.localizedCaseInsensitiveContains(q) || $0.name.localizedCaseInsensitiveContains(q)
        }
    }

    private func insertCommand(_ command: OttoChatCommand) {
        text = command.label + " "
        selection = NSRange(location: text.count, length: 0)
        showCommandPopup = false
    }

    private func insertMention(file: OttoChatMentionFile) {
        guard let range = mentionRange else { return }
        let nsText = text as NSString
        let replacement = "@\(file.path) "
        text = nsText.replacingCharacters(in: range, with: replacement)
        let cursor = range.location + (replacement as NSString).length
        selection = NSRange(location: cursor, length: 0)
        showMentionPopup = false
    }

    private func handleKeyDown(_ event: NSEvent) -> Bool {
        // Up/Down arrow + Enter for popups, Esc to close.
        if showCommandPopup {
            let visible = OttoChatCommandCatalog.filtered(by: commandQuery)
            switch event.keyCode {
            case 125: // ↓
                commandSelectedIndex = min(commandSelectedIndex + 1, max(visible.count - 1, 0))
                return true
            case 126: // ↑
                commandSelectedIndex = max(commandSelectedIndex - 1, 0)
                return true
            case 36, 76: // Return / Enter
                if let command = visible[safe: commandSelectedIndex] {
                    insertCommand(command)
                    return true
                }
            case 53: // Esc
                showCommandPopup = false
                return true
            default:
                break
            }
        }
        if showMentionPopup {
            let visible = filteredMentionFiles
            switch event.keyCode {
            case 125:
                mentionSelectedIndex = min(mentionSelectedIndex + 1, max(visible.count - 1, 0))
                return true
            case 126:
                mentionSelectedIndex = max(mentionSelectedIndex - 1, 0)
                return true
            case 36, 76:
                if let file = visible[safe: mentionSelectedIndex] {
                    insertMention(file: file)
                    return true
                }
            case 53:
                showMentionPopup = false
                return true
            default:
                break
            }
        }
        return false
    }
}

// MARK: - Attachment chip

private struct OttoChatAttachmentChip: View {
    let attachment: OttoChatAttachment
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            content
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.white.opacity(0.10), lineWidth: 0.5)
                )

            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white, .black.opacity(0.6))
            }
            .buttonStyle(.plain)
            .padding(.top, -6)
            .padding(.trailing, -6)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch attachment.kind {
        case .image:
            if let image = attachment.previewImage {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 40, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                placeholder(systemName: "photo")
            }
        case .pdf:
            HStack(spacing: 6) {
                Image(systemName: "doc.richtext.fill").foregroundStyle(.red)
                Text(attachment.name).font(.system(size: 11, weight: .medium)).lineLimit(1)
            }
        case .text:
            HStack(spacing: 6) {
                Image(systemName: "doc.text.fill").foregroundStyle(.blue)
                Text(attachment.name).font(.system(size: 11, weight: .medium)).lineLimit(1)
            }
        }
    }

    private func placeholder(systemName: String) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 18))
            .foregroundStyle(.secondary)
            .frame(width: 40, height: 40)
            .background(Color.primary.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

// MARK: - Command popup

private struct OttoChatCommandPopup: View {
    let query: String
    @Binding var selectedIndex: Int
    let onSelect: (OttoChatCommand) -> Void

    var body: some View {
        let visible = OttoChatCommandCatalog.filtered(by: query)
        VStack(spacing: 0) {
            ForEach(Array(visible.enumerated()), id: \.element.id) { index, command in
                Button {
                    onSelect(command)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: command.symbolName)
                            .font(.system(size: 11, weight: .semibold))
                            .frame(width: 16)
                            .foregroundStyle(.secondary)
                        Text(command.label)
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        Spacer()
                        Text(command.description)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        index == selectedIndex
                            ? Color.accentColor.opacity(0.18)
                            : Color.clear
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.white.opacity(0.10), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.25), radius: 18, y: 8)
    }
}

// MARK: - Mention popup

private struct OttoChatMentionPopup: View {
    let files: [OttoChatMentionFile]
    @Binding var selectedIndex: Int
    let onSelect: (OttoChatMentionFile) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(files.prefix(8).enumerated()), id: \.element.id) { index, file in
                Button {
                    onSelect(file)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: file.isChanged ? "doc.badge.gearshape" : "doc")
                            .font(.system(size: 11, weight: .semibold))
                            .frame(width: 16)
                            .foregroundStyle(file.isChanged ? Color.orange : .secondary)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(file.name)
                                .font(.system(size: 12, weight: .medium))
                            Text(file.path)
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.head)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        index == selectedIndex
                            ? Color.accentColor.opacity(0.18)
                            : Color.clear
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.white.opacity(0.10), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.25), radius: 18, y: 8)
    }
}

// MARK: - Utilities

extension Array {
    fileprivate subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
