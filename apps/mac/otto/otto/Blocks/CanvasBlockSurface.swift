import AppKit
import SwiftUI

struct CanvasBlockSurface: View {
    @Bindable var model: AppModel
    let workspace: Workspace
    let block: CanvasBlock
    var isActive = true

    var body: some View {
        ZStack {
            if let layout = block.layout, !block.children.isEmpty {
                CanvasLayoutRenderer(
                    model: model,
                    workspace: workspace,
                    canvas: block,
                    node: layout,
                    isCanvasActive: isActive
                )
                .padding(4)

                if model.canvasPickerBlockID == block.id {
                    if model.customCommandRequest?.canvasID == block.id {
                        commandModalOverlay
                    } else {
                        pickerOverlay
                    }
                }
            } else {
                if model.customCommandRequest?.canvasID == block.id {
                    commandModalOverlay
                } else {
                    picker
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.primary.opacity(0.018))
    }

    private var pickerOverlay: some View {
        ZStack {
            Rectangle()
                .fill(.regularMaterial)
                .opacity(0.72)
            Color.black.opacity(0.16)
            picker
        }
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

    private var picker: some View {
        BlockPickerView(
            options: creationOptions,
            onSelect: { model.createCanvasChildBlock(kind: $0.kind, in: block.id) },
            onCancel: { model.cancelCanvasBlockCreation() }
        )
    }

    private var creationOptions: [BlockCreationOption] {
        return BlockCatalog.creationOptions(includeCanvas: false)
    }
}

private struct CanvasLayoutRenderer: View {
    @Bindable var model: AppModel
    let workspace: Workspace
    let canvas: CanvasBlock
    let node: CanvasLayoutNode
    let isCanvasActive: Bool

    var body: some View {
        switch node {
        case .leaf(let blockID):
            if let child = canvas.children.first(where: { $0.id == blockID }) {
                CanvasChildBlockFrame(
                    model: model,
                    workspace: workspace,
                    block: child,
                    isFocused: isCanvasActive && canvas.focusedChildID == child.id,
                    onFocus: { model.focusCanvasChildBlock(child.id, in: canvas.id) },
                    onClose: {
                        if child.isPendingCreation {
                            model.cancelCanvasBlockCreation()
                        } else {
                            model.closeCanvasChildBlock(child.id, in: canvas.id)
                        }
                    }
                )
            }
        case .split(let id, let direction, let ratio, let first, let second):
            CanvasSplitPane(
                model: model,
                workspace: workspace,
                canvas: canvas,
                isCanvasActive: isCanvasActive,
                splitID: id,
                direction: direction,
                ratio: ratio,
                first: first,
                second: second
            )
        }
    }
}

private struct CanvasSplitPane: View {
    @Bindable var model: AppModel
    let workspace: Workspace
    let canvas: CanvasBlock
    let isCanvasActive: Bool
    let splitID: UUID
    let direction: SplitDirection
    let ratio: Double
    let first: CanvasLayoutNode
    let second: CanvasLayoutNode

    @State private var dragStartRatio: Double?
    @State private var liveRatio: Double?
    @State private var isDividerHovered = false

    private let dividerThickness: CGFloat = 8
    private let minimumPaneLength: CGFloat = 24

    var body: some View {
        GeometryReader { proxy in
            if direction == .horizontal {
                let availableWidth = max(0, proxy.size.width - dividerThickness)
                let firstWidth = splitLength(availableLength: availableWidth, ratio: ratio)
                let secondWidth = max(0, availableWidth - firstWidth)
                HStack(spacing: 0) {
                    CanvasLayoutRenderer(
                        model: model,
                        workspace: workspace,
                        canvas: canvas,
                        node: first,
                        isCanvasActive: isCanvasActive
                    )
                        .frame(width: firstWidth)
                    divider
                        .frame(width: dividerThickness)
                        .gesture(resizeGesture(availableLength: availableWidth))
                    CanvasLayoutRenderer(
                        model: model,
                        workspace: workspace,
                        canvas: canvas,
                        node: second,
                        isCanvasActive: isCanvasActive
                    )
                        .frame(width: secondWidth)
                }
                .overlay(alignment: .topLeading) {
                    liveDivider(availableLength: availableWidth, crossLength: proxy.size.height)
                }
            } else {
                let availableHeight = max(0, proxy.size.height - dividerThickness)
                let firstHeight = splitLength(availableLength: availableHeight, ratio: ratio)
                let secondHeight = max(0, availableHeight - firstHeight)
                VStack(spacing: 0) {
                    CanvasLayoutRenderer(
                        model: model,
                        workspace: workspace,
                        canvas: canvas,
                        node: first,
                        isCanvasActive: isCanvasActive
                    )
                        .frame(height: firstHeight)
                    divider
                        .frame(height: dividerThickness)
                        .gesture(resizeGesture(availableLength: availableHeight))
                    CanvasLayoutRenderer(
                        model: model,
                        workspace: workspace,
                        canvas: canvas,
                        node: second,
                        isCanvasActive: isCanvasActive
                    )
                        .frame(height: secondHeight)
                }
                .overlay(alignment: .topLeading) {
                    liveDivider(availableLength: availableHeight, crossLength: proxy.size.width)
                }
            }
        }
    }

    private var divider: some View {
        Rectangle()
            .fill(isDividerHovered ? Color.accentColor.opacity(0.22) : Color.primary.opacity(0.035))
            .contentShape(Rectangle())
            .onHover { hovering in
                guard hovering != isDividerHovered else { return }
                isDividerHovered = hovering
                if hovering {
                    resizeCursor.push()
                } else {
                    NSCursor.pop()
                }
            }
            .onDisappear {
                if isDividerHovered {
                    NSCursor.pop()
                    isDividerHovered = false
                }
            }
    }

    private var resizeCursor: NSCursor {
        direction == .horizontal ? .resizeLeftRight : .resizeUpDown
    }

    @ViewBuilder
    private func liveDivider(availableLength: CGFloat, crossLength: CGFloat) -> some View {
        if let liveRatio {
            let position = splitLength(availableLength: availableLength, ratio: liveRatio)
            Rectangle()
                .fill(Color.accentColor.opacity(0.48))
                .frame(
                    width: direction == .horizontal ? dividerThickness : crossLength,
                    height: direction == .horizontal ? crossLength : dividerThickness
                )
                .offset(
                    x: direction == .horizontal ? position : 0,
                    y: direction == .horizontal ? 0 : position
                )
                .allowsHitTesting(false)
        }
    }

    private func resizeGesture(availableLength: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                if dragStartRatio == nil { dragStartRatio = ratio }
                let translation = direction == .horizontal ? value.translation.width : value.translation.height
                let delta = availableLength > 0 ? Double(translation / availableLength) : 0
                liveRatio = clampedRatio((dragStartRatio ?? ratio) + delta)
            }
            .onEnded { value in
                let translation = direction == .horizontal ? value.translation.width : value.translation.height
                let delta = availableLength > 0 ? Double(translation / availableLength) : 0
                model.setCanvasSplitRatio(
                    splitID,
                    ratio: liveRatio ?? clampedRatio((dragStartRatio ?? ratio) + delta),
                    in: canvas.id
                )
                dragStartRatio = nil
                liveRatio = nil
            }
    }

    private func splitLength(availableLength: CGFloat, ratio: Double) -> CGFloat {
        guard availableLength > 0 else { return 0 }
        guard availableLength >= minimumPaneLength * 2 else { return availableLength / 2 }
        let rawLength = availableLength * CGFloat(ratio)
        return min(max(minimumPaneLength, rawLength), availableLength - minimumPaneLength)
    }

    private func clampedRatio(_ value: Double) -> Double {
        min(0.98, max(0.02, value))
    }
}

private struct CanvasChildBlockFrame: View {
    @Bindable var model: AppModel
    let workspace: Workspace
    let block: CanvasBlock
    let isFocused: Bool
    let onFocus: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                BlockKindIcon(kind: block.kind, size: 12)
                    .foregroundStyle(.secondary)
                Text(block.title)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .pressableCursor()
                .help("Close block")
            }
            .padding(.leading, 10)
            .frame(height: 32)
            .background(Color.primary.opacity(0.035))

            Divider()
                .opacity(0.35)

            childContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(
                    isFocused ? Color.accentColor.opacity(0.75) : Color.primary.opacity(0.10),
                    lineWidth: isFocused ? 1.5 : 1
                )
        )
        .padding(1)
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .onTapGesture(perform: onFocus)
    }

    @ViewBuilder
    private var childContent: some View {
        if block.isPendingCreation {
            VStack(spacing: 8) {
                Image(systemName: "plus.square.dashed")
                    .font(.system(size: 26, weight: .light))
                    .foregroundStyle(Color.accentColor)
                Text("Choose block type")
                    .font(.system(size: 13, weight: .semibold))
                Text("This split will be replaced by your selection.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 260)
            }
            .padding(18)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.accentColor.opacity(0.08))
        } else if block.kind.runsInTerminal {
            TerminalBlockView(
                block: block,
                session: model.terminalSession(for: block, in: workspace),
                isFocused: isFocused,
                onFocus: onFocus
            )
        } else if block.kind == .browser {
            BrowserBlockView(
                block: block,
                session: model.browserSession(for: block),
                isFocused: isFocused,
                onFocus: onFocus
            )
        } else if block.kind == .otto {
            OttoBlockView(
                block: block,
                workspace: workspace,
                runtime: model.ottoRuntimeSession(for: workspace),
                isFocused: isFocused,
                onFocus: onFocus
            )
        } else {
            VStack(spacing: 8) {
                BlockKindIcon(kind: block.kind, size: 24)
                    .foregroundStyle(.tertiary)
                Text(block.kind.defaultTitle)
                    .font(.system(size: 13, weight: .semibold))
                Text(description)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 260)
            }
            .padding(18)
        }
    }

    private var description: String {
        switch block.kind {
        case .canvas: "Nested canvas surface."
        case .otto: "Native Otto session surface."
        case .neovim: "Runs `nvim` in this workspace."
        case .terminal: "PTY-backed terminal surface."
        case .browser: "WKWebView preview surface."
        case .command: "Custom command terminal surface."
        case .claudeCode: "Runs `claude` in this workspace."
        case .codex: "Runs `codex` in this workspace."
        case .ottoTUI: "Runs `otto` in this workspace."
        case .openCode: "Runs `opencode` in this workspace."
        }
    }
}

#Preview {
    CanvasBlockSurface(
        model: AppModel(),
        workspace: Workspace.previewWorkspaces[0],
        block: CanvasBlock(
            kind: .canvas,
            children: [
                CanvasBlock(kind: .otto),
                CanvasBlock(kind: .terminal),
                CanvasBlock(kind: .browser)
            ]
        )
    )
}
