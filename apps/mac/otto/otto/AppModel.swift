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
    private var blockSelectionBeforePicker: CanvasBlock.ID?

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
            selectedWorkspaceID = newValue?.id
            selectedBlockID = newValue?.blocks.first?.id
        }
    }

    func selectWorkspace(_ workspace: Workspace) {
        selectedWorkspaceID = workspace.id
        selectedBlockID = workspace.blocks.first?.id
        isBlockPickerPresented = false
        canvasPickerBlockID = nil
    }

    func selectBlock(_ block: CanvasBlock) {
        selectedBlockID = block.id
        isBlockPickerPresented = false
        canvasPickerBlockID = nil
    }

    func beginBlockCreation() {
        guard selectedWorkspaceID != nil else { return }
        if let selectedBlockID,
           let selectedBlock = selectedWorkspace?.blocks.first(where: { $0.id == selectedBlockID }),
           selectedBlock.kind == .canvas {
            beginCanvasBlockCreation(in: selectedBlock)
            return
        }
        canvasPickerBlockID = nil
        blockSelectionBeforePicker = selectedBlockID
        selectedBlockID = nil
        isBlockPickerPresented = true
    }

    func cancelBlockCreation() {
        isBlockPickerPresented = false
        canvasPickerBlockID = nil
        selectedBlockID = blockSelectionBeforePicker ?? selectedWorkspace?.blocks.first?.id
        blockSelectionBeforePicker = nil
    }

    func createBlock(kind: BlockKind) {
        guard let index = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }) else { return }
        let block = CanvasBlock(kind: kind)
        workspaces[index].blocks.append(block)
        selectedBlockID = block.id
        isBlockPickerPresented = false
        canvasPickerBlockID = nil
        blockSelectionBeforePicker = nil
    }

    func beginCanvasBlockCreation(in canvas: CanvasBlock) {
        guard canvas.kind == .canvas else { return }
        selectedBlockID = canvas.id
        canvasPickerBlockID = canvas.id
    }

    func cancelCanvasBlockCreation() {
        canvasPickerBlockID = nil
    }

    func createCanvasChildBlock(kind: BlockKind, in canvasID: CanvasBlock.ID) {
        guard let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == canvasID })
        else { return }
        let child = CanvasBlock(kind: kind)
        var canvas = workspaces[workspaceIndex].blocks[canvasIndex]
        canvas.children.append(child)
        canvas.layout = CanvasLayoutNode.insert(
            blockID: child.id,
            into: canvas.layout,
            focusedID: canvas.focusedChildID
        )
        canvas.focusedChildID = child.id
        workspaces[workspaceIndex].blocks[canvasIndex] = canvas
        canvasPickerBlockID = nil
    }

    func closeCanvasChildBlock(_ childID: CanvasBlock.ID, in canvasID: CanvasBlock.ID) {
        guard let workspaceIndex = workspaces.firstIndex(where: { $0.id == selectedWorkspaceID }),
              let canvasIndex = workspaces[workspaceIndex].blocks.firstIndex(where: { $0.id == canvasID })
        else { return }
        var canvas = workspaces[workspaceIndex].blocks[canvasIndex]
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
        guard let blocks = selectedWorkspace?.blocks,
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
}
