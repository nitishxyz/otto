import AppKit
import Foundation

/// Lightweight terminal session handle kept by `AppModel` for block lifecycle.
///
/// The real terminal implementation now lives in `GhosttyKitTerminalView`, which
/// embeds GhosttyKit/libghostty surfaces directly. This type remains as a stable
/// model-level cache key so existing block lifecycle code can stop/discard
/// terminal resources when a block is closed.
@Observable
final class TerminalSession {
    let command: String?
    var error: String?
    @ObservationIgnored var ghosttyView: GhosttyKitTerminalNSView?

    init(command: String? = nil) {
        self.command = command
    }

    func start() {}
    func stop() {
        ghosttyView?.closeSurface()
        ghosttyView = nil
    }
}
