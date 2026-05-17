import Foundation
import Observation

@Observable
final class AppModel {
    var workspaces: [Workspace] = Workspace.previewWorkspaces
    var selectedWorkspaceID: Workspace.ID?
    var selectedBlockID: CanvasBlock.ID?
    var followAgentEnabled = true
    var isBlockPickerPresented = false
    var canvasPickerBlockID: CanvasBlock.ID?
    var canvasPickerSplitDirection: SplitDirection?
    private var canvasPickerPendingChildID: CanvasBlock.ID?
    private var canvasPickerPreviousFocusedChildID: CanvasBlock.ID?
    private var blockSelectionBeforePicker: CanvasBlock.ID?
    @ObservationIgnored private var terminalSessions: [CanvasBlock.ID: TerminalSession] = [:]

    init() {
        selectedWorkspaceID = workspaces.first?.id
        selectedBlockID = selectedWorkspace?.blocks.first?.id
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
        let block = CanvasBlock(kind: kind)
        workspaces[index].blocks.append(block)
        selectedBlockID = block.id
        isBlockPickerPresented = false
        resetCanvasPicker(removePending: true)
        blockSelectionBeforePicker = nil
    }

    func terminalSession(for block: CanvasBlock) -> TerminalSession {
        if let session = terminalSessions[block.id] {
            return session
        }
        let session = TerminalSession(command: block.launchCommand)
        terminalSessions[block.id] = session
        return session
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
        guard let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == canvasID })
        else {
            resetCanvasPicker(removePending: false)
            return
        }
        var canvas = workspaces[workspaceIndex].blocks[canvasIndex]
        if let pendingChildID = canvasPickerPendingChildID,
           let pendingIndex = canvas.children.firstIndex(where: { $0.id == pendingChildID }) {
            let child = CanvasBlock(id: pendingChildID, kind: kind)
            canvas.children[pendingIndex] = child
            canvas.focusedChildID = child.id
        } else {
            let child = CanvasBlock(kind: kind)
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
            discardTerminalSessions(in: removed)
        } else {
            discardTerminalSession(for: childID)
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
        if let block = workspaces[workspaceIndex].blocks.first(where: { $0.id == selectedBlockID }) {
            discardTerminalSessions(in: block)
        }
        workspaces[workspaceIndex].blocks.removeAll { $0.id == selectedBlockID }
        self.selectedBlockID = workspaces[workspaceIndex].blocks.first?.id
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
        canvasPickerPendingChildID = nil
        canvasPickerPreviousFocusedChildID = nil
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

    private func discardTerminalSessions(in block: CanvasBlock) {
        discardTerminalSession(for: block.id)
        for child in block.children {
            discardTerminalSessions(in: child)
        }
    }
}
