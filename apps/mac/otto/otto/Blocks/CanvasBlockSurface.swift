import SwiftUI

struct CanvasBlockSurface: View {
    @Bindable var model: AppModel
    let block: CanvasBlock

    var body: some View {
        ZStack {
            if model.canvasPickerBlockID == block.id {
                BlockPickerView(
                    options: BlockCatalog.creationOptions,
                    onSelect: { model.createCanvasChildBlock(kind: $0.kind, in: block.id) },
                    onCancel: { model.cancelCanvasBlockCreation() }
                )
            } else if block.children.isEmpty || block.layout == nil {
                emptyState
            } else if let layout = block.layout {
                CanvasLayoutRenderer(
                    model: model,
                    canvas: block,
                    node: layout
                )
                .padding(4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.primary.opacity(0.018))
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.split.2x2")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(.tertiary)

            VStack(spacing: 4) {
                Text("No blocks yet")
                    .font(.system(size: 15, weight: .semibold))
                Text("Add Otto, terminal, browser, and command surfaces to this canvas.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                model.beginCanvasBlockCreation(in: block)
            } label: {
                Label("Add Block", systemImage: "plus")
                    .font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)

            Text("Press ⌘N while focused on this Canvas to add a split block.")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct CanvasLayoutRenderer: View {
    @Bindable var model: AppModel
    let canvas: CanvasBlock
    let node: CanvasLayoutNode

    var body: some View {
        switch node {
        case .leaf(let blockID):
            if let child = canvas.children.first(where: { $0.id == blockID }) {
                CanvasChildBlockFrame(
                    model: model,
                    block: child,
                    isFocused: canvas.focusedChildID == child.id,
                    onFocus: { model.focusCanvasChildBlock(child.id, in: canvas.id) },
                    onClose: { model.closeCanvasChildBlock(child.id, in: canvas.id) }
                )
            }
        case .split(let id, let direction, let ratio, let first, let second):
            CanvasSplitPane(
                model: model,
                canvas: canvas,
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
    let canvas: CanvasBlock
    let splitID: UUID
    let direction: SplitDirection
    let ratio: Double
    let first: CanvasLayoutNode
    let second: CanvasLayoutNode

    @State private var dragStartRatio: Double?

    var body: some View {
        GeometryReader { proxy in
            if direction == .horizontal {
                HStack(spacing: 0) {
                    CanvasLayoutRenderer(model: model, canvas: canvas, node: first)
                        .frame(width: max(80, proxy.size.width * ratio))
                    divider
                        .frame(width: 4)
                        .gesture(resizeGesture(availableLength: proxy.size.width))
                    CanvasLayoutRenderer(model: model, canvas: canvas, node: second)
                        .frame(maxWidth: .infinity)
                }
            } else {
                VStack(spacing: 0) {
                    CanvasLayoutRenderer(model: model, canvas: canvas, node: first)
                        .frame(height: max(70, proxy.size.height * ratio))
                    divider
                        .frame(height: 4)
                        .gesture(resizeGesture(availableLength: proxy.size.height))
                    CanvasLayoutRenderer(model: model, canvas: canvas, node: second)
                        .frame(maxHeight: .infinity)
                }
            }
        }
    }

    private var divider: some View {
        Rectangle()
            .fill(Color.clear)
            .contentShape(Rectangle())
            .onHover { hovering in
                if hovering {
                    NSCursor.resizeLeftRight.set()
                } else {
                    NSCursor.arrow.set()
                }
            }
    }

    private func resizeGesture(availableLength: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                if dragStartRatio == nil { dragStartRatio = ratio }
                let translation = direction == .horizontal ? value.translation.width : value.translation.height
                let delta = availableLength > 0 ? Double(translation / availableLength) : 0
                model.setCanvasSplitRatio(
                    splitID,
                    ratio: (dragStartRatio ?? ratio) + delta,
                    in: canvas.id
                )
            }
            .onEnded { _ in
                dragStartRatio = nil
            }
    }
}

private struct CanvasChildBlockFrame: View {
    @Bindable var model: AppModel
    let block: CanvasBlock
    let isFocused: Bool
    let onFocus: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: block.kind.symbolName)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                Text(block.title)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 20, height: 20)
                }
                .buttonStyle(.plain)
                .help("Close block")
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(Color.primary.opacity(0.035))

            Divider()
                .opacity(0.35)

            childContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(nsColor: .windowBackgroundColor))
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
        if block.kind.runsInTerminal {
            TerminalBlockView(
                block: block,
                session: model.terminalSession(for: block),
                isFocused: isFocused,
                onFocus: onFocus
            )
        } else {
            VStack(spacing: 8) {
                Image(systemName: block.kind.symbolName)
                    .font(.system(size: 24, weight: .light))
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
        case .neovim: "Embedded Neovim editor surface."
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
