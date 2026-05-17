import SwiftUI

struct WorkspaceContentView: View {
    @Bindable var model: AppModel
    @State private var retainedWorkspaceIDs: Set<Workspace.ID> = []
    @State private var retainedBlockIDsByWorkspace: [Workspace.ID: Set<CanvasBlock.ID>] = [:]

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.regularMaterial)

            if let workspace = model.selectedWorkspace {
                RetainedWorkspaceSurfaceStack(
                    model: model,
                    selectedWorkspaceID: workspace.id,
                    selectedBlockID: model.selectedBlockID,
                    retainedWorkspaces: retainedWorkspaces,
                    retainedBlockIDsByWorkspace: retainedBlockIDsByWorkspace
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
        .onAppear(perform: retainSelectedSurface)
        .onChange(of: model.selectedBlockID) { _, _ in retainSelectedSurface() }
        .onChange(of: model.selectedWorkspaceID) { _, _ in retainSelectedSurface() }
        .onChange(of: model.workspaces) { _, _ in pruneRetainedSurfaces() }
    }

    private var commandModalOverlay: some View {
        ZStack {
            Rectangle()
                .fill(.regularMaterial)
                .opacity(0.72)
            Color.black.opacity(0.16)
            CustomCommandModalView(
                onSubmit: { model.confirmCustomCommand(label: $0, command: $1) },
                onCancel: { model.cancelCustomCommandCreation() }
            )
        }
    }

    private var retainedWorkspaces: [Workspace] {
        model.workspaces.filter { workspace in
            retainedWorkspaceIDs.contains(workspace.id) || workspace.id == model.selectedWorkspaceID
        }
    }

    private func retainSelectedSurface() {
        guard let selectedWorkspaceID = model.selectedWorkspaceID else { return }
        retainedWorkspaceIDs.insert(selectedWorkspaceID)
        if let selectedBlockID = model.selectedBlockID {
            retainedBlockIDsByWorkspace[selectedWorkspaceID, default: []].insert(selectedBlockID)
        }
        pruneRetainedSurfaces()
    }

    private func pruneRetainedSurfaces() {
        let workspaceIDs = Set(model.workspaces.map(\.id))
        retainedWorkspaceIDs = retainedWorkspaceIDs.intersection(workspaceIDs)
        retainedBlockIDsByWorkspace = retainedBlockIDsByWorkspace.reduce(into: [:]) { result, entry in
            guard let workspace = model.workspaces.first(where: { $0.id == entry.key }) else { return }
            let blockIDs = Set(workspace.blocks.map(\.id))
            let retainedBlockIDs = entry.value.intersection(blockIDs)
            if !retainedBlockIDs.isEmpty {
                result[entry.key] = retainedBlockIDs
            }
        }
    }

    private func selectedBlock(in workspace: Workspace) -> CanvasBlock? {
        guard let selectedBlockID = model.selectedBlockID else { return nil }
        return workspace.blocks.first { $0.id == selectedBlockID }
    }
}

private struct RetainedWorkspaceSurfaceStack: View {
    @Bindable var model: AppModel
    let selectedWorkspaceID: Workspace.ID
    let selectedBlockID: CanvasBlock.ID?
    let retainedWorkspaces: [Workspace]
    let retainedBlockIDsByWorkspace: [Workspace.ID: Set<CanvasBlock.ID>]

    var body: some View {
        ZStack {
            ForEach(retainedWorkspaces) { workspace in
                let isActiveWorkspace = workspace.id == selectedWorkspaceID
                RetainedBlockSurfaceStack(
                    model: model,
                    workspace: workspace,
                    selectedBlockID: isActiveWorkspace ? selectedBlockID : nil,
                    retainedBlockIDs: retainedBlockIDsByWorkspace[workspace.id] ?? []
                )
                .opacity(isActiveWorkspace ? 1 : 0)
                .allowsHitTesting(isActiveWorkspace)
                .zIndex(isActiveWorkspace ? 1 : 0)
            }
        }
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
                BlockSurface(model: model, workspace: workspace, block: block, isActive: isActive)
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
    let workspace: Workspace
    let block: CanvasBlock
    var isActive = true

    @State private var isRenaming = false
    @State private var draftTitle = ""
    @FocusState private var isTitleFieldFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                BlockKindIcon(kind: block.kind, size: 12)
                    .foregroundStyle(.secondary)
                titleView
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
                    Button("Rename…") { beginRenaming() }
                    Button("Duplicate") {}
                    Divider()
                    Button("Close Block", role: .destructive) { model.closeWorkspaceBlock(block.id) }
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
    private var titleView: some View {
        if isRenaming {
            TextField("Block title", text: $draftTitle)
                .textFieldStyle(.plain)
                .font(.system(size: 12, weight: .medium))
                .focused($isTitleFieldFocused)
                .frame(minWidth: 120, maxWidth: 260)
                .onSubmit(commitRename)
                .onExitCommand(perform: cancelRename)
        } else {
            Button(action: beginRenaming) {
                Text(block.title)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .pressableCursor()
            .help("Rename block")
        }
    }

    private func beginRenaming() {
        draftTitle = block.title
        isRenaming = true
        DispatchQueue.main.async {
            isTitleFieldFocused = true
        }
    }

    private func commitRename() {
        model.renameWorkspaceBlock(block.id, title: draftTitle)
        isRenaming = false
        isTitleFieldFocused = false
    }

    private func cancelRename() {
        draftTitle = block.title
        isRenaming = false
        isTitleFieldFocused = false
    }

    @ViewBuilder
    private var content: some View {
        if block.kind == .canvas {
            CanvasBlockSurface(model: model, workspace: workspace, block: block, isActive: isActive)
        } else if block.kind == .otto {
            OttoBlockView(
                block: block,
                workspace: workspace,
                runtime: model.ottoRuntimeSession(for: workspace),
                isFocused: isActive,
                onFocus: { model.selectBlock(block) }
            )
        } else if block.kind == .browser {
            BrowserBlockView(block: block, session: model.browserSession(for: block), isFocused: isActive)
        } else if block.kind.runsInTerminal {
            TerminalBlockView(block: block, session: model.terminalSession(for: block, in: workspace), isFocused: isActive)
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
