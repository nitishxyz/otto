import SwiftUI

struct PressableCursorModifier: ViewModifier {
    func body(content: Content) -> some View {
        content.onHover { isHovered in
            if isHovered {
                NSCursor.pointingHand.push()
            } else {
                NSCursor.pop()
            }
        }
    }
}

extension View {
    func pressableCursor() -> some View {
        modifier(PressableCursorModifier())
    }
}
