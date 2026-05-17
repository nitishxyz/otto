import SwiftUI

struct WorkspaceContentView: View {
    @Bindable var model: AppModel
    @State private var retainedBlockIDs: Set<CanvasBlock.ID> = []

    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)

            if let workspace = model.selectedWorkspace {
                RetainedBlockSurfaceStack(
                    model: model,
                    workspace: workspace,
                    selectedBlockID: model.selectedBlockID,
                    retainedBlockIDs: retainedBlockIDs
                )
                .opacity(model.isBlockPickerPresented || model.selectedBlockID == nil ? 0 : 1)
                .allowsHitTesting(!model.isBlockPickerPresented && model.selectedBlockID != nil)

                if model.customCommandRequest?.canvasID == nil, model.customCommandRequest != nil {
                    commandModalOverlay
                } else if model.isBlockPickerPresented {
                    BlockPickerView(
                        options: BlockCatalog.creationOptions,
                        onSelect: { model.createBlock(kind: $0.kind) },
                        onCancel: { model.cancelBlockCreation() }
                    )
                } else if selectedBlock(in: workspace) == nil {
                    ContentUnavailableView(
                        "No Block Selected",
                        systemImage: "square.split.2x2",
                        description: Text("Pick a block from the sidebar or create a new one with ⌘N.")
                    )
                }
            } else {
                ContentUnavailableView(
                    "No Workspace",
                    systemImage: "folder",
                    description: Text("Choose or add a workspace to begin.")
                )
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.primary.opacity(0.09), lineWidth: 1)
        )
        .padding(.vertical, 6)
        .onAppear(perform: retainSelectedBlock)
        .onChange(of: model.selectedBlockID) { _, _ in retainSelectedBlock() }
        .onChange(of: model.selectedWorkspaceID) { _, _ in
            retainedBlockIDs.removeAll()
            retainSelectedBlock()
        }
    }

    private var commandModalOverlay: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
                .opacity(0.72)
            Color.black.opacity(0.16)
            CustomCommandModalView(
                onSubmit: { model.confirmCustomCommand(label: $0, command: $1) },
                onCancel: { model.cancelCustomCommandCreation() }
            )
        }
    }

    private func retainSelectedBlock() {
        guard let selectedBlockID = model.selectedBlockID else { return }
        retainedBlockIDs.insert(selectedBlockID)
    }

    private func selectedBlock(in workspace: Workspace) -> CanvasBlock? {
        guard let selectedBlockID = model.selectedBlockID else { return nil }
        return workspace.blocks.first { $0.id == selectedBlockID }
    }
}

private struct RetainedBlockSurfaceStack: View {
    @Bindable var model: AppModel
    let workspace: Workspace
    let selectedBlockID: CanvasBlock.ID?
    let retainedBlockIDs: Set<CanvasBlock.ID>

    var body: some View {
        ZStack {
            ForEach(visibleBlocks) { block in
                let isActive = block.id == selectedBlockID
                BlockSurface(model: model, block: block, isActive: isActive)
                    .opacity(isActive ? 1 : 0)
                    .allowsHitTesting(isActive)
                    .zIndex(isActive ? 1 : 0)
            }
        }
    }

    private var visibleBlocks: [CanvasBlock] {
        workspace.blocks.filter { block in
            retainedBlockIDs.contains(block.id) || block.id == selectedBlockID
        }
    }
}

private struct BlockSurface: View {
    @Bindable var model: AppModel
    let block: CanvasBlock
    var isActive = true

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                BlockKindIcon(kind: block.kind, size: 12)
                    .foregroundStyle(.secondary)
                Text(block.title)
                    .font(.system(size: 12, weight: .medium))
                Spacer()
                if block.kind == .canvas {
                    Button {
                        model.beginCanvasBlockCreation(in: block)
                    } label: {
                        Label("Add Block", systemImage: "plus")
                            .labelStyle(.iconOnly)
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                    .pressableCursor()
                    .help("Add block to canvas")
                }
                Menu {
                    Button("Rename…") {}
                    Button("Duplicate") {}
                    Divider()
                    Button("Close Block", role: .destructive) { model.closeSelectedBlock() }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 22, height: 22)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .pressableCursor()
            }
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(.bar)

            Divider()
                .opacity(0.4)

            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private var content: some View {
        if block.kind == .canvas {
            CanvasBlockSurface(model: model, block: block)
        } else if block.kind == .browser {
            BrowserBlockView(block: block, session: model.browserSession(for: block), isFocused: isActive)
        } else if block.kind.runsInTerminal {
            TerminalBlockView(block: block, session: model.terminalSession(for: block), isFocused: isActive)
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        VStack(spacing: 10) {
            BlockKindIcon(kind: block.kind, size: 28)
                .foregroundStyle(.tertiary)
            Text(block.kind.defaultTitle)
                .font(.system(size: 15, weight: .semibold))
            Text(placeholderSubtitle)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var placeholderSubtitle: String {
        switch block.kind {
        case .canvas: "Native multi-block canvas layout will render here."
        case .otto: "Native Otto session UI will render here once wired up."
        case .neovim: "Embedded Neovim with follow-agent file opens."
        case .terminal: "PTY-backed native terminal surface."
        case .browser: "WKWebView preview for localhost apps and docs."
        case .command: "Command runner backed by a native terminal surface."
        case .claudeCode: "Launches `claude` in this workspace."
        case .codex: "Launches `codex` in this workspace."
        case .ottoTUI: "Launches `otto` in this workspace."
        case .openCode: "Launches `opencode` in this workspace."
        }
    }
}
