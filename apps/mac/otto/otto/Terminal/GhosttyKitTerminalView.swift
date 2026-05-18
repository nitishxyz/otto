import AppKit
import GhosttyKit
import SwiftUI

private let ottoGhosttyFontSize: Float = 13

@MainActor
private final class EmbeddedGhosttyRuntime {
    static let shared = EmbeddedGhosttyRuntime()

    private var app: ghostty_app_t?
    private var config: ghostty_config_t?
    private var initialized = false
    private var isTickScheduled = false
    private var isTicking = false

    var appHandle: ghostty_app_t? {
        ensureStarted()
        return app
    }

    private func ensureStarted() {
        guard !initialized else { return }
        initialized = true

        guard ghostty_init(UInt(CommandLine.argc), CommandLine.unsafeArgv) == GHOSTTY_SUCCESS else {
            return
        }

        let config = ghostty_config_new()
        ghostty_config_load_default_files(config)
        ghostty_config_finalize(config)
        self.config = config

        var runtimeConfig = ghostty_runtime_config_s(
            userdata: Unmanaged.passUnretained(self).toOpaque(),
            supports_selection_clipboard: false,
            wakeup_cb: { userdata in
                guard let userdata else { return }
                let runtime = Unmanaged<EmbeddedGhosttyRuntime>.fromOpaque(userdata).takeUnretainedValue()
                DispatchQueue.main.async { runtime.tick() }
            },
            action_cb: { _, _, _ in false },
            read_clipboard_cb: { _, _, _ in false },
            confirm_read_clipboard_cb: { _, _, _, _ in },
            write_clipboard_cb: { _, _, _, _, _ in },
            close_surface_cb: { _, _ in }
        )

        self.app = ghostty_app_new(&runtimeConfig, config)
        if let app {
            ghostty_app_set_focus(app, NSApp.isActive)
        }
    }

    func tick() {
        guard let app else { return }
        ghostty_app_tick(app)
    }

    deinit {
        if let app { ghostty_app_free(app) }
        if let config { ghostty_config_free(config) }
    }
}

struct GhosttyKitTerminalView: NSViewRepresentable {
    let block: CanvasBlock
    let session: TerminalSession
    let isFocused: Bool
    let focusRequestID: Int
    let onFocus: () -> Void

    func makeNSView(context: Context) -> GhosttyKitTerminalContainerNSView {
        let container = GhosttyKitTerminalContainerNSView()
        container.configure(
            terminalView: terminalView(),
            isFocused: isFocused,
            focusRequestID: focusRequestID,
            onFocus: onFocus
        )
        return container
    }

    func updateNSView(_ nsView: GhosttyKitTerminalContainerNSView, context: Context) {
        nsView.configure(
            terminalView: terminalView(),
            isFocused: isFocused,
            focusRequestID: focusRequestID,
            onFocus: onFocus
        )
    }

    private func terminalView() -> GhosttyKitTerminalNSView {
        if let view = session.ghosttyView {
            view.isFocused = isFocused
            view.onFocus = onFocus
            return view
        }
        let view = GhosttyKitTerminalNSView(
            command: Self.shellWrappedCommand(block.launchCommand),
            workingDirectory: session.workingDirectory,
            isFocused: isFocused,
            onFocus: onFocus
        )
        session.ghosttyView = view
        return view
    }

    private static func shellWrappedCommand(_ command: String?) -> String? {
        guard let command, !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        let shell = ProcessInfo.processInfo.environment["SHELL"].flatMap { $0.isEmpty ? nil : $0 } ?? "/bin/zsh"
        return "\(shell) -ilc \(shellQuote("exec \(command)"))"
    }

    private static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

final class GhosttyKitTerminalContainerNSView: NSView {
    private weak var terminalView: GhosttyKitTerminalNSView?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var isFlipped: Bool { true }

    func configure(
        terminalView nextView: GhosttyKitTerminalNSView,
        isFocused: Bool,
        focusRequestID: Int,
        onFocus: @escaping () -> Void
    ) {
        if terminalView !== nextView {
            terminalView?.removeFromSuperview()
            nextView.removeFromSuperview()
            nextView.frame = bounds
            nextView.autoresizingMask = [.width, .height]
            addSubview(nextView)
            terminalView = nextView
        }

        nextView.isFocused = isFocused
        nextView.onFocus = onFocus
        nextView.refreshAfterAttachment()
        nextView.handleFocusRequest(focusRequestID)
        needsLayout = true
    }

    override func layout() {
        super.layout()
        terminalView?.frame = bounds
        terminalView?.refreshAfterAttachment()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        terminalView?.refreshAfterAttachment()
    }
}

final class GhosttyKitTerminalNSView: NSView {
    var isFocused: Bool {
        didSet {
            guard oldValue != isFocused else { return }
            if let surface {
                ghostty_surface_set_focus(surface, isFocused)
            }
            if isFocused {
                focusTerminal()
            } else if window?.firstResponder === self {
                window?.makeFirstResponder(nil)
            }
        }
    }
    var onFocus: () -> Void

    private let command: String?
    private let workingDirectory: String
    private var surface: ghostty_surface_t?
    private var pendingAttachmentRefresh = false
    private var lastHandledFocusRequestID = 0

    init(command: String?, workingDirectory: String, isFocused: Bool, onFocus: @escaping () -> Void) {
        self.command = command
        self.workingDirectory = workingDirectory
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

    deinit {
        closeSurface()
    }

    func handleFocusRequest(_ requestID: Int) {
        guard requestID != lastHandledFocusRequestID else { return }
        lastHandledFocusRequestID = requestID
        guard isFocused else { return }
        focusTerminal()
    }

    func closeSurface() {
        if let surface {
            ghostty_surface_free(surface)
            self.surface = nil
        }
    }

    override var acceptsFirstResponder: Bool { true }
    override var isFlipped: Bool { true }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        refreshAfterAttachment()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        updateSurfaceScale()
        updateSurfaceSize()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        refreshAfterAttachment()
    }

    override func mouseDown(with event: NSEvent) {
        onFocus()
        focusTerminal()
        guard let surface else { return }
        let point = convert(event.locationInWindow, from: nil)
        ghostty_surface_mouse_pos(surface, point.x, point.y, ghosttyMods(event.modifierFlags))
        _ = ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_LEFT, ghosttyMods(event.modifierFlags))
    }

    override func mouseUp(with event: NSEvent) {
        guard let surface else { return }
        let point = convert(event.locationInWindow, from: nil)
        ghostty_surface_mouse_pos(surface, point.x, point.y, ghosttyMods(event.modifierFlags))
        _ = ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_LEFT, ghosttyMods(event.modifierFlags))
    }

    override func mouseMoved(with event: NSEvent) {
        guard let surface else { return }
        let point = convert(event.locationInWindow, from: nil)
        ghostty_surface_mouse_pos(surface, point.x, point.y, ghosttyMods(event.modifierFlags))
    }

    override func scrollWheel(with event: NSEvent) {
        onFocus()
        guard let surface else { return }
        ghostty_surface_mouse_scroll(
            surface,
            event.scrollingDeltaX,
            event.scrollingDeltaY,
            scrollMods(for: event)
        )
    }

    override func keyDown(with event: NSEvent) {
        guard isFocused else { return }
        _ = keyAction(event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS, event: event)
    }

    override func keyUp(with event: NSEvent) {
        guard isFocused else { return }
        _ = keyAction(GHOSTTY_ACTION_RELEASE, event: event)
    }

    override func insertText(_ insertString: Any) {
        guard isFocused else { return }
        if let text = insertString as? String {
            sendText(text)
        } else if let attributed = insertString as? NSAttributedString {
            sendText(attributed.string)
        }
    }

    func paste(_ sender: Any?) {
        guard isFocused, let text = NSPasteboard.general.string(forType: .string) else { return }
        sendText(text)
    }

    func copy(_ sender: Any?) {}

    private func createSurfaceIfNeeded() {
        guard surface == nil, window != nil, let app = EmbeddedGhosttyRuntime.shared.appHandle else { return }

        var config = ghostty_surface_config_new()
        config.userdata = Unmanaged.passUnretained(self).toOpaque()
        config.platform_tag = GHOSTTY_PLATFORM_MACOS
        config.platform = ghostty_platform_u(macos: ghostty_platform_macos_s(nsview: Unmanaged.passUnretained(self).toOpaque()))
        config.scale_factor = Double(window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 1)
        config.font_size = ottoGhosttyFontSize
        config.context = GHOSTTY_SURFACE_CONTEXT_SPLIT

        workingDirectory.withCString { cwd in
            config.working_directory = cwd
            if let command {
                command.withCString { commandPointer in
                    config.command = commandPointer
                    surface = ghostty_surface_new(app, &config)
                }
            } else {
                surface = ghostty_surface_new(app, &config)
            }
        }

        updateSurfaceScale()
        updateSurfaceSize()
        if let surface {
            ghostty_surface_set_focus(surface, isFocused)
        }
    }

    private func focusTerminal() {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isFocused, self.window?.firstResponder !== self else { return }
            self.window?.makeFirstResponder(self)
        }
    }

    private func focusTerminalIfWindowHasNoResponder() {
        DispatchQueue.main.async { [weak self] in
            guard let self,
                  self.isFocused,
                  let window = self.window,
                  window.firstResponder == nil else { return }
            window.makeFirstResponder(self)
        }
    }

    private func sendText(_ text: String) {
        guard let surface else { return }
        text.withCString { pointer in
            ghostty_surface_text(surface, pointer, UInt(text.utf8.count))
        }
    }

    private func keyAction(_ action: ghostty_input_action_e, event: NSEvent) -> Bool {
        guard let surface else { return false }
        var keyEvent = ghostty_input_key_s()
        keyEvent.action = action
        keyEvent.mods = ghosttyMods(event.modifierFlags)
        keyEvent.consumed_mods = ghosttyMods(event.modifierFlags.subtracting([.control, .command]))
        keyEvent.keycode = UInt32(event.keyCode)
        keyEvent.composing = false
        if let chars = event.characters(byApplyingModifiers: []), let scalar = chars.unicodeScalars.first {
            keyEvent.unshifted_codepoint = scalar.value
        }

        guard action != GHOSTTY_ACTION_RELEASE, let text = ghosttyCharacters(for: event), !text.isEmpty else {
            return ghostty_surface_key(surface, keyEvent)
        }
        return text.withCString { pointer in
            keyEvent.text = pointer
            return ghostty_surface_key(surface, keyEvent)
        }
    }

    private func ghosttyCharacters(for event: NSEvent) -> String? {
        guard let characters = event.characters else { return nil }
        if characters.count == 1, let scalar = characters.unicodeScalars.first {
            if scalar.value < 0x20 {
                return event.characters(byApplyingModifiers: event.modifierFlags.subtracting(.control))
            }
            if scalar.value >= 0xF700 && scalar.value <= 0xF8FF {
                return nil
            }
        }
        return characters
    }

    private func ghosttyMods(_ flags: NSEvent.ModifierFlags) -> ghostty_input_mods_e {
        var mods: UInt32 = GHOSTTY_MODS_NONE.rawValue
        if flags.contains(.shift) { mods |= GHOSTTY_MODS_SHIFT.rawValue }
        if flags.contains(.control) { mods |= GHOSTTY_MODS_CTRL.rawValue }
        if flags.contains(.option) { mods |= GHOSTTY_MODS_ALT.rawValue }
        if flags.contains(.command) { mods |= GHOSTTY_MODS_SUPER.rawValue }
        if flags.contains(.capsLock) { mods |= GHOSTTY_MODS_CAPS.rawValue }
        return ghostty_input_mods_e(mods)
    }

    private func scrollMods(for event: NSEvent) -> ghostty_input_scroll_mods_t {
        var value: Int32 = 0
        if event.hasPreciseScrollingDeltas {
            value |= 0b0000_0001
        }
        value |= Int32(momentumValue(event.momentumPhase)) << 1
        return value
    }

    private func momentumValue(_ phase: NSEvent.Phase) -> UInt8 {
        switch phase {
        case .began: 1
        case .stationary: 2
        case .changed: 3
        case .ended: 4
        case .cancelled: 5
        case .mayBegin: 6
        default: 0
        }
    }

    private func updateSurfaceScale() {
        guard let surface else { return }
        let scale = Double(window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 1)
        ghostty_surface_set_content_scale(surface, scale, scale)
    }

    private func updateSurfaceDisplay() {
        guard let surface else {
            return
        }
        let screenNumber = window?.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
        if let displayID = screenNumber as? UInt32 {
            ghostty_surface_set_display_id(surface, displayID)
        } else if let displayID = screenNumber as? NSNumber {
            ghostty_surface_set_display_id(surface, displayID.uint32Value)
        }
    }

    func refreshAfterAttachment() {
        createSurfaceIfNeeded()
        updateSurfaceDisplay()
        updateSurfaceScale()
        updateSurfaceSize()

        guard window != nil, !pendingAttachmentRefresh else { return }
        pendingAttachmentRefresh = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.pendingAttachmentRefresh = false
            guard self.window != nil else { return }
            self.updateSurfaceDisplay()
            self.updateSurfaceScale()
            self.updateSurfaceSize()
            if let surface = self.surface {
                ghostty_surface_draw(surface)
            }
            if self.isFocused {
                self.focusTerminalIfWindowHasNoResponder()
            }
        }
    }

    func updateSurfaceSize() {
        createSurfaceIfNeeded()
        guard let surface else { return }
        let size = convertToBacking(bounds.size)
        ghostty_surface_set_size(surface, UInt32(max(size.width, 1)), UInt32(max(size.height, 1)))
        ghostty_surface_refresh(surface)
    }
}
