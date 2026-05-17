import AppKit
import Foundation
import Observation

struct CustomCommandRequest: Identifiable, Hashable {
    let id = UUID()
    let canvasID: CanvasBlock.ID?
}

private struct PersistedAppState: Codable {
    var workspaces: [Workspace]
    var selectedWorkspaceID: Workspace.ID?
    var selectedBlockID: CanvasBlock.ID?
}

@MainActor
@Observable
final class AppModel {
    private static let persistedStateKey = "io.ottocode.otto.native.state.v1"

    var workspaces: [Workspace] = [] {
        didSet { persistState() }
    }
    var selectedWorkspaceID: Workspace.ID? {
        didSet { persistState() }
    }
    var selectedBlockID: CanvasBlock.ID? {
        didSet { persistState() }
    }
    var followAgentEnabled = true
    var isBlockPickerPresented = false
    var canvasPickerBlockID: CanvasBlock.ID?
    var canvasPickerSplitDirection: SplitDirection?
    var customCommandRequest: CustomCommandRequest?
    private var canvasPickerPendingChildID: CanvasBlock.ID?
    private var canvasPickerPreviousFocusedChildID: CanvasBlock.ID?
    private var blockSelectionBeforePicker: CanvasBlock.ID?
    @ObservationIgnored private var terminalSessions: [CanvasBlock.ID: TerminalSession] = [:]
    @ObservationIgnored private var browserSessions: [CanvasBlock.ID: BrowserSession] = [:]
    @ObservationIgnored private var ottoRuntimeSessions: [Workspace.ID: OttoWorkspaceRuntimeSession] = [:]
    @ObservationIgnored private var isRestoringPersistedState = false

    init() {
        restorePersistedState()
    }

    var selectedWorkspace: Workspace? {
        get {
            guard let selectedWorkspaceID else { return nil }
            return workspaces.first { $0.id == selectedWorkspaceID }
        }
        set {
            resetCanvasPicker(removePending: true)
            selectedWorkspaceID = newValue?.id
            selectedBlockID = newValue?.blocks.first?.id
            isBlockPickerPresented = false
            if let newValue {
                startOttoRuntime(for: newValue)
            }
        }
    }

    var selectedWorkspaceSidebarBlocks: [CanvasBlock] {
        selectedWorkspace?.sidebarOrderedBlocks ?? []
    }

    func selectWorkspace(_ workspace: Workspace) {
        resetCanvasPicker(removePending: true)
        selectedWorkspaceID = workspace.id
        selectedBlockID = workspace.blocks.first?.id
        isBlockPickerPresented = false
        startOttoRuntime(for: workspace)
    }

    func addWorkspaceFromOpenPanel() {
        let panel = NSOpenPanel()
        panel.title = "Choose project folder"
        panel.prompt = "Open Workspace"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = selectedWorkspace.map { URL(fileURLWithPath: expandedPath($0.path), isDirectory: true) }

        guard panel.runModal() == .OK, let url = panel.url else { return }
        addWorkspace(path: url.path)
    }

    func addWorkspace(path: String) {
        let expanded = expandedPath(path)
        let workspace = Workspace(
            name: Self.workspaceName(from: expanded),
            path: expanded,
            accent: WorkspaceAccent.allCases[workspaces.count % WorkspaceAccent.allCases.count],
            blocks: []
        )
        workspaces.append(workspace)
        selectWorkspace(workspace)
    }

    func removeWorkspace(_ workspace: Workspace) {
        ottoRuntimeSessions.removeValue(forKey: workspace.id)?.stop()
        for block in workspace.blocks {
            discardBlockSessions(in: block)
        }
        workspaces.removeAll { $0.id == workspace.id }
        if selectedWorkspaceID == workspace.id {
            selectedWorkspaceID = workspaces.first?.id
            selectedBlockID = selectedWorkspace?.blocks.first?.id
            if let selectedWorkspace {
                startOttoRuntime(for: selectedWorkspace)
            }
        }
    }

    func selectBlock(_ block: CanvasBlock) {
        resetCanvasPicker(removePending: true)
        selectedBlockID = block.id
        isBlockPickerPresented = false
    }

    func beginBlockCreation() {
        guard selectedWorkspaceID != nil else { return }
        if let selectedBlockID,
           let selectedBlock = selectedWorkspace?.blocks.first(where: { $0.id == selectedBlockID }),
           selectedBlock.kind == .canvas {
            beginCanvasBlockCreation(in: selectedBlock)
            return
        }
        resetCanvasPicker(removePending: true)
        blockSelectionBeforePicker = selectedBlockID
        selectedBlockID = nil
        isBlockPickerPresented = true
    }

    func beginWorkspaceBlockCreation() {
        guard selectedWorkspaceID != nil else { return }
        resetCanvasPicker(removePending: true)
        blockSelectionBeforePicker = selectedBlockID
        selectedBlockID = nil
        isBlockPickerPresented = true
    }

    func cancelBlockCreation() {
        isBlockPickerPresented = false
        resetCanvasPicker(removePending: true)
        selectedBlockID = blockSelectionBeforePicker ?? selectedWorkspace?.blocks.first?.id
        blockSelectionBeforePicker = nil
    }

    func createBlock(kind: BlockKind) {
        guard let index = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }) else { return }
        guard kind != .command else {
            isBlockPickerPresented = false
            customCommandRequest = CustomCommandRequest(canvasID: nil)
            return
        }
        let block = CanvasBlock(kind: kind)
        workspaces[index].blocks.append(block)
        selectedBlockID = block.id
        isBlockPickerPresented = false
        resetCanvasPicker(removePending: true)
        blockSelectionBeforePicker = nil
    }

    func terminalSession(for block: CanvasBlock, in workspace: Workspace? = nil) -> TerminalSession {
        if let session = terminalSessions[block.id] {
            return session
        }
        let session = TerminalSession(
            command: block.launchCommand,
            workingDirectory: expandedPath(workspace?.path ?? selectedWorkspace?.path ?? "~")
        )
        terminalSessions[block.id] = session
        return session
    }

    func browserSession(for block: CanvasBlock) -> BrowserSession {
        if let session = browserSessions[block.id] {
            return session
        }
        let session = BrowserSession()
        browserSessions[block.id] = session
        return session
    }

    func ottoRuntimeSession(for workspace: Workspace) -> OttoWorkspaceRuntimeSession {
        if let session = ottoRuntimeSessions[workspace.id], session.workspacePath == expandedPath(workspace.path) {
            return session
        }
        ottoRuntimeSessions[workspace.id]?.stop()
        let session = OttoWorkspaceRuntimeSession(workspaceID: workspace.id, workspacePath: workspace.path)
        ottoRuntimeSessions[workspace.id] = session
        return session
    }

    func startOttoRuntime(for workspace: Workspace) {
        ottoRuntimeSession(for: workspace).start()
    }

    func beginCanvasBlockCreation(in canvas: CanvasBlock, direction: SplitDirection? = nil) {
        guard canvas.kind == .canvas else { return }
        resetCanvasPicker(removePending: true)
        selectedBlockID = canvas.id
        canvasPickerBlockID = canvas.id
        canvasPickerSplitDirection = direction
        guard let direction,
              let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == canvas.id })
        else { return }
        var currentCanvas = workspaces[workspaceIndex].blocks[canvasIndex]
        guard !currentCanvas.children.isEmpty else { return }
        canvasPickerPreviousFocusedChildID = currentCanvas.focusedChildID
        let pendingChild = CanvasBlock(
            kind: .command,
            title: "New Block",
            subtitle: "Choose block type",
            launchCommand: nil,
            isPendingCreation: true
        )
        currentCanvas.children.append(pendingChild)
        currentCanvas.layout = CanvasLayoutNode.insert(
            blockID: pendingChild.id,
            into: currentCanvas.layout,
            focusedID: currentCanvas.focusedChildID,
            direction: direction
        )
        currentCanvas.focusedChildID = pendingChild.id
        workspaces[workspaceIndex].blocks[canvasIndex] = currentCanvas
        canvasPickerPendingChildID = pendingChild.id
    }

    func beginSelectedCanvasSplit(direction: SplitDirection) {
        guard let selectedBlockID,
              let selectedBlock = selectedWorkspace?.blocks.first(where: { $0.id == selectedBlockID }),
              selectedBlock.kind == .canvas
        else { return }
        beginCanvasBlockCreation(in: selectedBlock, direction: direction)
    }

    func cancelCanvasBlockCreation() {
        resetCanvasPicker(removePending: true)
    }

    func createCanvasChildBlock(kind: BlockKind, in canvasID: CanvasBlock.ID) {
        guard kind != .command else {
            customCommandRequest = CustomCommandRequest(canvasID: canvasID)
            return
        }
        let child = CanvasBlock(kind: kind)
        insertCanvasChildBlock(child, in: canvasID)
    }

    func confirmCustomCommand(label: String, command: String) {
        guard let customCommandRequest else { return }
        let trimmedCommand = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCommand.isEmpty else { return }
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = trimmedLabel.isEmpty ? Self.commandTitle(from: trimmedCommand) : trimmedLabel
        let blockID = canvasPickerPendingChildID ?? UUID()
        let block = CanvasBlock(
            id: blockID,
            kind: .command,
            title: title,
            subtitle: trimmedCommand,
            launchCommand: trimmedCommand
        )
        if let canvasID = customCommandRequest.canvasID {
            insertCanvasChildBlock(block, in: canvasID)
        } else if let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }) {
            workspaces[workspaceIndex].blocks.append(block)
            selectedBlockID = block.id
            isBlockPickerPresented = false
            blockSelectionBeforePicker = nil
            resetCanvasPicker(removePending: false)
        }
        self.customCommandRequest = nil
    }

    func cancelCustomCommandCreation() {
        let isWorkspaceCommand = customCommandRequest?.canvasID == nil
        customCommandRequest = nil
        if isWorkspaceCommand {
            cancelBlockCreation()
        } else {
            resetCanvasPicker(removePending: true)
        }
    }

    private func insertCanvasChildBlock(_ child: CanvasBlock, in canvasID: CanvasBlock.ID) {
        guard let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == canvasID })
        else {
            resetCanvasPicker(removePending: false)
            return
        }
        var canvas = workspaces[workspaceIndex].blocks[canvasIndex]
        if let pendingChildID = canvasPickerPendingChildID,
           let pendingIndex = canvas.children.firstIndex(where: { $0.id == pendingChildID }) {
            let replacement = CanvasBlock(
                id: pendingChildID,
                kind: child.kind,
                title: child.title,
                subtitle: child.subtitle,
                launchCommand: child.launchCommand,
                children: child.children,
                layout: child.layout,
                focusedChildID: child.focusedChildID
            )
            canvas.children[pendingIndex] = replacement
            canvas.focusedChildID = replacement.id
        } else {
            canvas.children.append(child)
            canvas.layout = CanvasLayoutNode.insert(
                blockID: child.id,
                into: canvas.layout,
                focusedID: canvas.focusedChildID,
                direction: canvasPickerSplitDirection
            )
            canvas.focusedChildID = child.id
        }
        workspaces[workspaceIndex].blocks[canvasIndex] = canvas
        resetCanvasPicker(removePending: false)
    }

    func closeCanvasChildBlock(_ childID: CanvasBlock.ID, in canvasID: CanvasBlock.ID) {
        guard let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == canvasID })
        else { return }
        var canvas = workspaces[workspaceIndex].blocks[canvasIndex]
        if let removed = canvas.children.first(where: { $0.id == childID }) {
            discardBlockSessions(in: removed)
        } else {
            discardBlockSession(for: childID)
        }
        canvas.children.removeAll { $0.id == childID }
        canvas.layout = CanvasLayoutNode.remove(blockID: childID, from: canvas.layout)
        if canvas.focusedChildID == childID {
            canvas.focusedChildID = CanvasLayoutNode.blockIDs(in: canvas.layout).first
        }
        workspaces[workspaceIndex].blocks[canvasIndex] = canvas
    }

    func focusCanvasChildBlock(_ childID: CanvasBlock.ID, in canvasID: CanvasBlock.ID) {
        guard let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == canvasID })
        else { return }
        workspaces[workspaceIndex].blocks[canvasIndex].focusedChildID = childID
    }

    func setCanvasSplitRatio(_ splitID: UUID, ratio: Double, in canvasID: CanvasBlock.ID) {
        guard let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == canvasID }),
              let layout = workspaces[workspaceIndex].blocks[canvasIndex].layout
        else { return }
        workspaces[workspaceIndex].blocks[canvasIndex].layout = CanvasLayoutNode.updateRatio(
            splitID: splitID,
            ratio: ratio,
            in: layout
        )
    }

    func closeSelectedBlock() {
        guard let selectedBlockID,
              let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID })
        else { return }
        if let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == selectedBlockID }),
           workspaces[workspaceIndex].blocks[canvasIndex].kind == .canvas,
           let focusedChildID = workspaces[workspaceIndex].blocks[canvasIndex].focusedChildID {
            closeCanvasChildBlock(focusedChildID, in: selectedBlockID)
            return
        }
        closeWorkspaceBlock(selectedBlockID)
    }

    func closeWorkspaceBlock(_ blockID: CanvasBlock.ID) {
        guard let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }) else { return }
        if let block = workspaces[workspaceIndex].blocks.first(where: { $0.id == blockID }) {
            discardBlockSessions(in: block)
        }
        workspaces[workspaceIndex].blocks.removeAll { $0.id == blockID }
        if selectedBlockID == blockID {
            selectedBlockID = workspaces[workspaceIndex].blocks.first?.id
        }
    }

    func renameWorkspaceBlock(_ blockID: CanvasBlock.ID, title: String) {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty,
              let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let blockIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == blockID })
        else { return }
        workspaces[workspaceIndex].blocks[blockIndex].title = trimmedTitle
    }

    func selectNextBlock() {
        if focusCanvasChild(offset: 1) { return }
        selectBlock(offset: 1)
    }

    func selectPreviousBlock() {
        if focusCanvasChild(offset: -1) { return }
        selectBlock(offset: -1)
    }

    func selectBlock(at index: Int) {
        guard let blocks = selectedWorkspace?.sidebarOrderedBlocks,
              blocks.indices.contains(index)
        else { return }
        selectBlock(blocks[index])
    }

    func createBlock(forKeyEquivalent keyEquivalent: String) -> Bool {
        guard isBlockPickerPresented,
              let option = BlockCatalog.creationOptions.first(where: { $0.keyEquivalent == keyEquivalent })
        else { return false }
        createBlock(kind: option.kind)
        return true
    }

    func focusCanvasChild(at index: Int) {
        guard let selectedBlockID,
              let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == selectedBlockID })
        else { return }
        let orderedIDs = CanvasLayoutNode.blockIDs(in: workspaces[workspaceIndex].blocks[canvasIndex].layout)
        guard orderedIDs.indices.contains(index) else { return }
        workspaces[workspaceIndex].blocks[canvasIndex].focusedChildID = orderedIDs[index]
    }

    func focusCanvasChild(direction: CanvasFocusDirection) {
        guard let selectedBlockID,
              let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == selectedBlockID }),
              let focusedChildID = workspaces[workspaceIndex].blocks[canvasIndex].focusedChildID
        else { return }
        let canvas = workspaces[workspaceIndex].blocks[canvasIndex]
        guard let nextID = CanvasLayoutNode.neighbor(
            from: focusedChildID,
            direction: direction,
            in: canvas.layout
        ) else { return }
        workspaces[workspaceIndex].blocks[canvasIndex].focusedChildID = nextID
    }

    private func selectBlock(offset: Int) {
        guard let blocks = selectedWorkspace?.blocks,
              !blocks.isEmpty
        else { return }
        let currentIndex = selectedBlockID.flatMap { id in blocks.firstIndex { $0.id == id } } ?? 0
        let nextIndex = (currentIndex + offset + blocks.count) % blocks.count
        selectBlock(blocks[nextIndex])
    }

    private func focusCanvasChild(offset: Int) -> Bool {
        guard let selectedBlockID,
              let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == selectedBlockID }),
              workspaces[workspaceIndex].blocks[canvasIndex].kind == .canvas
        else { return false }
        let orderedIDs = CanvasLayoutNode.blockIDs(in: workspaces[workspaceIndex].blocks[canvasIndex].layout)
        guard !orderedIDs.isEmpty else { return false }
        let currentID = workspaces[workspaceIndex].blocks[canvasIndex].focusedChildID
        let currentIndex = currentID.flatMap { orderedIDs.firstIndex(of: $0) } ?? 0
        let nextIndex = (currentIndex + offset + orderedIDs.count) % orderedIDs.count
        workspaces[workspaceIndex].blocks[canvasIndex].focusedChildID = orderedIDs[nextIndex]
        return true
    }

    private func resetCanvasPicker(removePending: Bool) {
        if removePending {
            removePendingCanvasChild()
        }
        canvasPickerBlockID = nil
        canvasPickerSplitDirection = nil
        customCommandRequest = nil
        canvasPickerPendingChildID = nil
        canvasPickerPreviousFocusedChildID = nil
    }

    private static func commandTitle(from command: String) -> String {
        let firstLine = command.components(separatedBy: .newlines).first ?? command
        let trimmed = firstLine.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Custom" : String(trimmed.prefix(36))
    }

    private static func workspaceName(from path: String) -> String {
        let url = URL(fileURLWithPath: path)
        let name = url.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "workspace" : name
    }

    private func expandedPath(_ path: String) -> String {
        (path as NSString).expandingTildeInPath
    }

    private func restorePersistedState() {
        isRestoringPersistedState = true
        defer { isRestoringPersistedState = false }

        guard let data = UserDefaults.standard.data(forKey: Self.persistedStateKey),
              let state = try? JSONDecoder().decode(PersistedAppState.self, from: data)
        else {
            workspaces = []
            selectedWorkspaceID = nil
            selectedBlockID = nil
            return
        }

        workspaces = state.workspaces
        selectedWorkspaceID = state.selectedWorkspaceID.flatMap { selectedID in
            workspaces.contains { $0.id == selectedID } ? selectedID : nil
        } ?? workspaces.first?.id

        if let selectedWorkspace,
           let selectedBlockID = state.selectedBlockID,
           selectedWorkspace.blocks.contains(where: { $0.id == selectedBlockID }) {
            self.selectedBlockID = selectedBlockID
        } else {
            selectedBlockID = selectedWorkspace?.blocks.first?.id
        }

        if let selectedWorkspace {
            startOttoRuntime(for: selectedWorkspace)
        }
    }

    private func persistState() {
        guard !isRestoringPersistedState else { return }
        let state = PersistedAppState(
            workspaces: workspaces,
            selectedWorkspaceID: selectedWorkspaceID,
            selectedBlockID: selectedBlockID
        )
        guard let data = try? JSONEncoder().encode(state) else { return }
        UserDefaults.standard.set(data, forKey: Self.persistedStateKey)
    }

    private func removePendingCanvasChild() {
        guard let canvasID = canvasPickerBlockID,
              let pendingChildID = canvasPickerPendingChildID,
              let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == canvasID })
        else { return }
        var canvas = workspaces[workspaceIndex].blocks[canvasIndex]
        canvas.children.removeAll { $0.id == pendingChildID }
        canvas.layout = CanvasLayoutNode.remove(blockID: pendingChildID, from: canvas.layout)
        let orderedIDs = CanvasLayoutNode.blockIDs(in: canvas.layout)
        if let previousFocusedID = canvasPickerPreviousFocusedChildID,
           orderedIDs.contains(previousFocusedID) {
            canvas.focusedChildID = previousFocusedID
        } else {
            canvas.focusedChildID = orderedIDs.first
        }
        workspaces[workspaceIndex].blocks[canvasIndex] = canvas
    }

    private func discardTerminalSession(for blockID: CanvasBlock.ID) {
        terminalSessions.removeValue(forKey: blockID)?.stop()
    }

    private func discardBrowserSession(for blockID: CanvasBlock.ID) {
        browserSessions.removeValue(forKey: blockID)?.stop()
    }

    private func discardBlockSession(for blockID: CanvasBlock.ID) {
        discardTerminalSession(for: blockID)
        discardBrowserSession(for: blockID)
    }

    private func discardBlockSessions(in block: CanvasBlock) {
        discardTerminalSession(for: block.id)
        discardBrowserSession(for: block.id)
        for child in block.children {
            discardBlockSessions(in: child)
        }
    }
}
