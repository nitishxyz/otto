import AppKit
import SwiftUI

/// A SwiftUI wrapper around `NSTextView` that exposes the
/// information SwiftUI's built-in `TextEditor` can't give us:
///
/// - bindings for both `text` and the current `selectionRange`
/// - autosize between `minHeight` and `maxHeight` based on content
/// - key handler hook (`onKeyDown`) for popup navigation + send
/// - paste callback for native image/file paste later
/// - focus binding via `FocusState`
///
/// Used by `OttoChatInputView` to power the otto composer.
struct OttoNativeTextEditor: NSViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRange
    @Binding var measuredHeight: CGFloat
    var placeholder: String = "Message"
    var font: NSFont = .systemFont(ofSize: 13)
    var minHeight: CGFloat = 22
    var maxHeight: CGFloat = 200
    var isFocused: Bool = false
    var onKeyDown: ((NSEvent) -> Bool)? = nil
    var onPaste: ((NSPasteboard) -> Bool)? = nil
    var onSubmit: (() -> Void)? = nil

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = false
        scrollView.hasHorizontalScroller = false
        scrollView.drawsBackground = false
        scrollView.autohidesScrollers = true

        let bigSize = CGFloat.greatestFiniteMagnitude
        let textStorage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        textStorage.addLayoutManager(layoutManager)
        let container = NSTextContainer(size: NSSize(width: 0, height: bigSize))
        container.widthTracksTextView = true
        container.heightTracksTextView = false
        layoutManager.addTextContainer(container)

        let chatTextView = OttoChatTextView(frame: .zero, textContainer: container)
        chatTextView.coordinator = context.coordinator
        chatTextView.isRichText = false
        chatTextView.allowsUndo = true
        chatTextView.isAutomaticQuoteSubstitutionEnabled = false
        chatTextView.isAutomaticDashSubstitutionEnabled = false
        chatTextView.isAutomaticTextReplacementEnabled = false
        chatTextView.smartInsertDeleteEnabled = false
        chatTextView.font = font
        chatTextView.textColor = .labelColor
        chatTextView.drawsBackground = false
        chatTextView.delegate = context.coordinator
        chatTextView.textContainerInset = NSSize(width: 0, height: 6)
        chatTextView.string = text
        chatTextView.isHorizontallyResizable = false
        chatTextView.isVerticallyResizable = true
        chatTextView.autoresizingMask = [.width]
        chatTextView.minSize = NSSize(width: 0, height: 0)
        chatTextView.maxSize = NSSize(width: bigSize, height: bigSize)

        scrollView.documentView = chatTextView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? OttoChatTextView else { return }

        if textView.string != text {
            textView.string = text
        }

        if textView.selectedRange() != selection {
            let safeRange = NSRange(
                location: min(selection.location, textView.string.count),
                length: 0
            )
            textView.setSelectedRange(safeRange)
        }

        textView.placeholder = placeholder
        textView.font = font
        textView.coordinator = context.coordinator
        textView.needsDisplay = true

        if isFocused, textView.window?.firstResponder !== textView {
            DispatchQueue.main.async {
                textView.window?.makeFirstResponder(textView)
            }
        }

        DispatchQueue.main.async {
            updateMeasuredHeight(for: textView)
        }
    }

    private func updateMeasuredHeight(for textView: NSTextView) {
        guard let layoutManager = textView.layoutManager,
              let container = textView.textContainer else { return }
        layoutManager.ensureLayout(for: container)
        let used = layoutManager.usedRect(for: container).height
        let inset = textView.textContainerInset.height * 2
        let next = min(max(used + inset, minHeight), maxHeight)
        if abs(measuredHeight - next) > 0.5 {
            measuredHeight = next
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: OttoNativeTextEditor
        init(parent: OttoNativeTextEditor) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            parent.text = textView.string
            parent.selection = textView.selectedRange()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            parent.selection = textView.selectedRange()
        }
    }
}

/// `NSTextView` subclass that draws a placeholder and forwards key events to SwiftUI.
final class OttoChatTextView: NSTextView {
    weak var coordinator: OttoNativeTextEditor.Coordinator?
    var placeholder: String = ""

    override func keyDown(with event: NSEvent) {
        if let handler = coordinator?.parent.onKeyDown, handler(event) {
            return
        }

        // ⏎  = submit, ⇧⏎ = newline, ⌘⏎ = submit
        if event.keyCode == 36 { // Return
            if event.modifierFlags.contains(.shift) {
                super.keyDown(with: event)
                return
            }
            coordinator?.parent.onSubmit?()
            return
        }

        super.keyDown(with: event)
    }

    override func paste(_ sender: Any?) {
        if let handler = coordinator?.parent.onPaste,
           handler(NSPasteboard.general) {
            return
        }
        super.paste(sender)
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty, !placeholder.isEmpty else { return }
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font ?? NSFont.systemFont(ofSize: 13),
            .foregroundColor: NSColor.placeholderTextColor
        ]
        let origin = NSPoint(x: textContainerInset.width + 5,
                             y: textContainerInset.height)
        placeholder.draw(at: origin, withAttributes: attrs)
    }
}
