import AppKit
import SwiftUI

struct TerminalBlockView: View {
    let block: CanvasBlock
    let session: TerminalSession
    let isFocused: Bool
    let onFocus: () -> Void

    init(block: CanvasBlock, session: TerminalSession, isFocused: Bool = true, onFocus: @escaping () -> Void = {}) {
        self.block = block
        self.session = session
        self.isFocused = isFocused
        self.onFocus = onFocus
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            GhosttyTerminalSurface(session: session, isFocused: isFocused, onFocus: onFocus)
                .background(Color.black)

            if let error = session.error {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Terminal unavailable")
                        .font(.system(size: 12, weight: .semibold))
                    Text(error)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                .padding(12)
                .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 10))
                .padding(12)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 0))
        .onAppear { session.start() }
    }
}

private struct GhosttyTerminalSurface: NSViewRepresentable {
    let session: TerminalSession
    let isFocused: Bool
    let onFocus: () -> Void

    func makeNSView(context: Context) -> GhosttyTerminalNSView {
        let view = GhosttyTerminalNSView(session: session, isFocused: isFocused, onFocus: onFocus)
        view.postsFrameChangedNotifications = true
        view.installRedrawHandler()
        return view
    }

    func updateNSView(_ nsView: GhosttyTerminalNSView, context: Context) {
        nsView.session = session
        nsView.isFocused = isFocused
        nsView.onFocus = onFocus
        nsView.installRedrawHandler()
        nsView.needsDisplay = true
    }
}

private final class GhosttyTerminalNSView: NSView {
    var session: TerminalSession {
        didSet { needsDisplay = true }
    }
    var isFocused: Bool {
        didSet {
            if isFocused {
                focusTerminal()
            } else {
                resignTerminalFocus()
            }
        }
    }
    var onFocus: () -> Void

    init(session: TerminalSession, isFocused: Bool, onFocus: @escaping () -> Void) {
        self.session = session
        self.isFocused = isFocused
        self.onFocus = onFocus
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var acceptsFirstResponder: Bool { true }
    override var isFlipped: Bool { true }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if isFocused { focusTerminal() }
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        session.resize(width: newSize.width, height: newSize.height)
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        onFocus()
        focusTerminal()
    }

    override func scrollWheel(with event: NSEvent) {
        onFocus()
        session.scroll(deltaY: event.scrollingDeltaY, precise: event.hasPreciseScrollingDeltas)
    }

    func installRedrawHandler() {
        session.redrawHandler = { [weak self] in
            self?.needsDisplay = true
        }
    }

    func focusTerminal() {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isFocused, self.window?.firstResponder !== self else { return }
            self.window?.makeFirstResponder(self)
        }
    }

    func resignTerminalFocus() {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.window?.firstResponder === self else { return }
            self.window?.makeFirstResponder(nil)
        }
    }

    override func keyDown(with event: NSEvent) {
        guard isFocused else {
            return
        }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags.contains(.command) {
            switch event.keyCode {
            case 51:
                session.send("\u{15}")
            case 117:
                session.send("\u{0b}")
            default:
                interpretKeyEvents([event])
            }
            return
        }
        if flags.contains(.option), event.keyCode == 51 {
            session.send("\u{1b}\u{7f}")
            return
        }
        if let chars = event.characters, !chars.isEmpty {
            session.send(chars)
            return
        }
        interpretKeyEvents([event])
    }

    override func insertText(_ insertString: Any) {
        guard isFocused else { return }
        if let value = insertString as? String {
            session.send(value)
        } else if let attributed = insertString as? NSAttributedString {
            session.send(attributed.string)
        }
    }

    func paste(_ sender: Any?) {
        guard isFocused else { return }
        if let text = NSPasteboard.general.string(forType: .string) {
            session.send(text)
        }
    }

    func copy(_ sender: Any?) {}

    override func deleteBackward(_ sender: Any?) { if isFocused { session.send("\u{7f}") } }
    override func deleteForward(_ sender: Any?) { if isFocused { session.send("\u{1b}[3~") } }
    override func insertNewline(_ sender: Any?) { if isFocused { session.send("\r") } }
    override func insertTab(_ sender: Any?) { if isFocused { session.send("\t") } }
    override func moveUp(_ sender: Any?) { if isFocused { session.send("\u{1b}[A") } }
    override func moveDown(_ sender: Any?) { if isFocused { session.send("\u{1b}[B") } }
    override func moveRight(_ sender: Any?) { if isFocused { session.send("\u{1b}[C") } }
    override func moveLeft(_ sender: Any?) { if isFocused { session.send("\u{1b}[D") } }

    override func draw(_ dirtyRect: NSRect) {
        session.draw(in: bounds)
    }
}

#Preview {
    TerminalBlockView(block: CanvasBlock(kind: .terminal), session: TerminalSession())
        .frame(width: 640, height: 360)
}
