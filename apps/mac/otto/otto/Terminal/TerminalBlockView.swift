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
        GhosttyKitTerminalView(block: block, session: session, isFocused: isFocused, onFocus: onFocus)
            .id(block.id)
            .background(Color.black)
            .clipShape(RoundedRectangle(cornerRadius: 0))
    }
}

#Preview {
    TerminalBlockView(block: CanvasBlock(kind: .terminal), session: TerminalSession())
        .frame(width: 640, height: 360)
}
