import AppKit
import CoreText
import Darwin
import Foundation
import Observation

struct TerminalRuntime {
    var command: String
    var workingDirectory: String

    static let placeholder = TerminalRuntime(command: "zsh", workingDirectory: "~")
}

struct GhosttyRuntimeStatus: Equatable {
    var isLoaded: Bool
    var details: String
}

private typealias GhosttyHandle = UnsafeMutableRawPointer?

private let ghosttySuccess: CInt = 0
private let ghosttyTerminalOptUserdata: CInt = 0
private let ghosttyTerminalOptWritePTY: CInt = 1
private let ghosttyRenderStateDataRowIterator: CInt = 4
private let ghosttyRenderStateDataBackground: CInt = 5
private let ghosttyRenderStateDataForeground: CInt = 6
private let ghosttyRenderStateDataCursorVisualStyle: CInt = 10
private let ghosttyRenderStateDataCursorVisible: CInt = 11
private let ghosttyRenderStateDataCursorViewportHasValue: CInt = 14
private let ghosttyRenderStateDataCursorViewportX: CInt = 15
private let ghosttyRenderStateDataCursorViewportY: CInt = 16
private let ghosttyRenderStateRowDataCells: CInt = 3
private let ghosttyRenderStateRowCellsDataGraphemesLen: CInt = 3
private let ghosttyRenderStateRowCellsDataGraphemesBuf: CInt = 4
private let ghosttyRenderStateRowCellsDataBgColor: CInt = 5
private let ghosttyRenderStateRowCellsDataFgColor: CInt = 6
private let terminalPaddingX: CGFloat = 2
private let terminalPaddingY: CGFloat = 2

private struct GhosttyTerminalOptions {
    var cols: UInt16
    var rows: UInt16
    var maxScrollback: Int
}

private struct GhosttyColorRGB: Equatable {
    var r: UInt8
    var g: UInt8
    var b: UInt8
}

@_silgen_name("ghostty_terminal_new") private func ghostty_terminal_new(_ allocator: UnsafeRawPointer?, _ terminal: UnsafeMutablePointer<GhosttyHandle>, _ options: GhosttyTerminalOptions) -> CInt
@_silgen_name("ghostty_terminal_free") private func ghostty_terminal_free(_ terminal: GhosttyHandle)
@_silgen_name("ghostty_terminal_resize") private func ghostty_terminal_resize(_ terminal: GhosttyHandle, _ cols: UInt16, _ rows: UInt16, _ cellWidth: UInt32, _ cellHeight: UInt32) -> CInt
@_silgen_name("ghostty_terminal_set") private func ghostty_terminal_set(_ terminal: GhosttyHandle, _ option: CInt, _ value: UnsafeRawPointer?) -> CInt
@_silgen_name("ghostty_terminal_vt_write") private func ghostty_terminal_vt_write(_ terminal: GhosttyHandle, _ data: UnsafePointer<UInt8>, _ len: Int)
@_silgen_name("otto_ghostty_terminal_scroll_viewport_delta") private func otto_ghostty_terminal_scroll_viewport_delta(_ terminal: GhosttyHandle, _ delta: Int)
@_silgen_name("ghostty_render_state_new") private func ghostty_render_state_new(_ allocator: UnsafeRawPointer?, _ state: UnsafeMutablePointer<GhosttyHandle>) -> CInt
@_silgen_name("ghostty_render_state_free") private func ghostty_render_state_free(_ state: GhosttyHandle)
@_silgen_name("ghostty_render_state_update") private func ghostty_render_state_update(_ state: GhosttyHandle, _ terminal: GhosttyHandle) -> CInt
@_silgen_name("ghostty_render_state_get") private func ghostty_render_state_get(_ state: GhosttyHandle, _ data: CInt, _ out: UnsafeMutableRawPointer?) -> CInt
@_silgen_name("ghostty_render_state_row_iterator_new") private func ghostty_render_state_row_iterator_new(_ allocator: UnsafeRawPointer?, _ iterator: UnsafeMutablePointer<GhosttyHandle>) -> CInt
@_silgen_name("ghostty_render_state_row_iterator_free") private func ghostty_render_state_row_iterator_free(_ iterator: GhosttyHandle)
@_silgen_name("ghostty_render_state_row_iterator_next") private func ghostty_render_state_row_iterator_next(_ iterator: GhosttyHandle) -> Bool
@_silgen_name("ghostty_render_state_row_get") private func ghostty_render_state_row_get(_ iterator: GhosttyHandle, _ data: CInt, _ out: UnsafeMutableRawPointer?) -> CInt
@_silgen_name("ghostty_render_state_row_cells_new") private func ghostty_render_state_row_cells_new(_ allocator: UnsafeRawPointer?, _ cells: UnsafeMutablePointer<GhosttyHandle>) -> CInt
@_silgen_name("ghostty_render_state_row_cells_free") private func ghostty_render_state_row_cells_free(_ cells: GhosttyHandle)
@_silgen_name("ghostty_render_state_row_cells_next") private func ghostty_render_state_row_cells_next(_ cells: GhosttyHandle) -> Bool
@_silgen_name("ghostty_render_state_row_cells_get") private func ghostty_render_state_row_cells_get(_ cells: GhosttyHandle, _ data: CInt, _ out: UnsafeMutableRawPointer?) -> CInt

private func ghosttyWritePTYCallback(_ terminal: GhosttyHandle, _ userdata: UnsafeMutableRawPointer?, _ data: UnsafePointer<UInt8>?, _ len: Int) {
    guard let userdata, let data, len > 0 else { return }
    let session = Unmanaged<TerminalSession>.fromOpaque(userdata).takeUnretainedValue()
    session.writePTY(data: data, length: len)
}

enum GhosttyRuntimeLoader {
    static func load() -> GhosttyRuntimeStatus {
        GhosttyRuntimeStatus(isLoaded: true, details: "libghostty-vt linked from vendor/ghostty")
    }
}

@Observable
final class TerminalSession {
    struct Geometry {
        var cols: UInt16 = 80
        var rows: UInt16 = 24
        var cellWidth: UInt32 = 9
        var cellHeight: UInt32 = 18
    }

    private let command: String?
    private let workingDirectory: String
    private let shellPath: String
    private let lock = NSRecursiveLock()
    private var terminal: GhosttyHandle = nil
    private var renderState: GhosttyHandle = nil
    private var masterFileDescriptor: Int32 = -1
    private var childPID: pid_t = -1
    private var readSource: DispatchSourceRead?
    private var scrollRemainder: CGFloat = 0

    @ObservationIgnored var redrawHandler: (() -> Void)?

    var isRunning = false
    var ghosttyStatus = GhosttyRuntimeLoader.load()
    var error: String?
    var revision = 0
    var geometry = Geometry()

    init(command: String? = nil, workingDirectory: String = FileManager.default.homeDirectoryForCurrentUser.path) {
        self.command = command
        self.workingDirectory = NSString(string: workingDirectory).expandingTildeInPath
        self.shellPath = Self.resolveUserShellPath()
        let metrics = TerminalFont.metrics(size: 13)
        self.geometry = Geometry(
            cols: 80,
            rows: 24,
            cellWidth: UInt32(metrics.cellWidth.rounded(.up)),
            cellHeight: UInt32(metrics.cellHeight.rounded(.up))
        )
    }

    deinit {
        stop()
    }

    func start() {
        guard childPID <= 0 else { return }
        do {
            try startGhosttyTerminal()
            try spawnShell()
            isRunning = true
            startReadingOutput()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func resize(width: CGFloat, height: CGFloat) {
        let metrics = TerminalFont.metrics(size: 13)
        let nextCellWidth = UInt32(metrics.cellWidth.rounded(.up))
        let nextCellHeight = UInt32(metrics.cellHeight.rounded(.up))
        let availableWidth = max(1, width - (terminalPaddingX * 2))
        let availableHeight = max(1, height - (terminalPaddingY * 2))
        let cols = max(UInt16(2), UInt16(max(2, Int(floor(availableWidth / CGFloat(nextCellWidth))))))
        let rows = max(UInt16(1), UInt16(max(1, Int(floor(availableHeight / CGFloat(nextCellHeight))))))
        guard cols != geometry.cols || rows != geometry.rows else { return }
        geometry = Geometry(cols: cols, rows: rows, cellWidth: nextCellWidth, cellHeight: nextCellHeight)
        lock.lock()
        if let terminal {
            _ = ghostty_terminal_resize(terminal, cols, rows, nextCellWidth, nextCellHeight)
        }
        lock.unlock()
        if masterFileDescriptor >= 0 {
            var window = winsize(ws_row: rows, ws_col: cols, ws_xpixel: UInt16(cols) * UInt16(nextCellWidth), ws_ypixel: UInt16(rows) * UInt16(nextCellHeight))
            _ = ioctl(masterFileDescriptor, TIOCSWINSZ, &window)
        }
        redrawHandler?()
    }

    func send(_ text: String) {
        guard masterFileDescriptor >= 0 else { return }
        Array(text.utf8).withUnsafeBytes { buffer in
            _ = Darwin.write(masterFileDescriptor, buffer.baseAddress, buffer.count)
        }
    }

    func scroll(deltaY: CGFloat, precise: Bool) {
        let normalizedDelta = precise ? deltaY / 32 : deltaY
        scrollRemainder += normalizedDelta
        let steps: Int
        if scrollRemainder > 0 {
            steps = Int(floor(scrollRemainder))
        } else {
            steps = Int(ceil(scrollRemainder))
        }
        guard steps != 0 else { return }
        scrollRemainder -= CGFloat(steps)
        scrollViewport(delta: deltaY > 0 ? -abs(steps) : abs(steps))
    }

    func scrollViewport(delta: Int) {
        lock.lock()
        if let terminal {
            otto_ghostty_terminal_scroll_viewport_delta(terminal, delta)
        }
        lock.unlock()
        redrawHandler?()
    }

    func stop() {
        readSource?.cancel()
        readSource = nil
        if childPID > 0 {
            kill(childPID, SIGTERM)
            childPID = -1
        }
        if masterFileDescriptor >= 0 {
            close(masterFileDescriptor)
            masterFileDescriptor = -1
        }
        lock.lock()
        if let renderState {
            ghostty_render_state_free(renderState)
            self.renderState = nil
        }
        if let terminal {
            ghostty_terminal_free(terminal)
            self.terminal = nil
        }
        lock.unlock()
        isRunning = false
    }

    func writePTY(data: UnsafePointer<UInt8>, length: Int) {
        guard masterFileDescriptor >= 0 else { return }
        var remaining = length
        var offset = 0
        while remaining > 0 {
            let written = Darwin.write(masterFileDescriptor, data.advanced(by: offset), remaining)
            if written > 0 {
                remaining -= written
                offset += written
            } else if errno != EINTR {
                break
            }
        }
    }

    func draw(in bounds: CGRect) {
        lock.lock()
        defer { lock.unlock() }
        guard let terminal, let renderState else {
            NSColor.black.setFill()
            bounds.fill()
            return
        }
        _ = ghostty_render_state_update(renderState, terminal)
        let background = readRenderColor(renderState, ghosttyRenderStateDataBackground, fallback: GhosttyColorRGB(r: 0, g: 0, b: 0))
        let foreground = readRenderColor(renderState, ghosttyRenderStateDataForeground, fallback: GhosttyColorRGB(r: 238, g: 238, b: 238))
        nsColor(background).setFill()
        bounds.fill()

        var rowIterator: GhosttyHandle = nil
        var rowCells: GhosttyHandle = nil
        guard ghostty_render_state_row_iterator_new(nil, &rowIterator) == ghosttySuccess,
              ghostty_render_state_row_cells_new(nil, &rowCells) == ghosttySuccess else { return }
        defer {
            ghostty_render_state_row_cells_free(rowCells)
            ghostty_render_state_row_iterator_free(rowIterator)
        }
        _ = withUnsafeMutablePointer(to: &rowIterator) { pointer in
            ghostty_render_state_get(renderState, ghosttyRenderStateDataRowIterator, UnsafeMutableRawPointer(pointer))
        }

        let metrics = TerminalFont.metrics(size: 13)
        let font = metrics.font
        let cellWidth = CGFloat(geometry.cellWidth)
        let cellHeight = CGFloat(geometry.cellHeight)
        let originX = terminalPaddingX
        let originY = terminalPaddingY
        var rowIndex = 0
        while ghostty_render_state_row_iterator_next(rowIterator) {
            _ = withUnsafeMutablePointer(to: &rowCells) { pointer in
                ghostty_render_state_row_get(rowIterator, ghosttyRenderStateRowDataCells, UnsafeMutableRawPointer(pointer))
            }
            var cellIndex = 0
            while ghostty_render_state_row_cells_next(rowCells) {
                let rect = CGRect(
                    x: originX + (CGFloat(cellIndex) * cellWidth),
                    y: originY + (CGFloat(rowIndex) * cellHeight),
                    width: cellWidth.rounded(.up),
                    height: cellHeight.rounded(.up)
                )
                var bg = background
                if ghostty_render_state_row_cells_get(rowCells, ghosttyRenderStateRowCellsDataBgColor, &bg) == ghosttySuccess {
                    nsColor(bg).setFill()
                    rect.fill()
                }
                var fg = foreground
                _ = ghostty_render_state_row_cells_get(rowCells, ghosttyRenderStateRowCellsDataFgColor, &fg)
                var len: UInt32 = 0
                _ = ghostty_render_state_row_cells_get(rowCells, ghosttyRenderStateRowCellsDataGraphemesLen, &len)
                if len > 0 {
                    var codepoints = [UInt32](repeating: 0, count: Int(len))
                    codepoints.withUnsafeMutableBufferPointer { buffer in
                        _ = ghostty_render_state_row_cells_get(rowCells, ghosttyRenderStateRowCellsDataGraphemesBuf, buffer.baseAddress)
                    }
                    let text = String(String.UnicodeScalarView(codepoints.compactMap(UnicodeScalar.init)))
                    text.draw(at: CGPoint(x: rect.minX, y: rect.minY + metrics.baselineOffset), withAttributes: [
                        .font: font,
                        .foregroundColor: nsColor(fg)
                    ])
                }
                cellIndex += 1
            }
            rowIndex += 1
        }

        drawCursor(
            renderState: renderState,
            cellWidth: cellWidth,
            cellHeight: cellHeight,
            originX: originX,
            originY: originY,
            foreground: foreground
        )
    }

    private func startGhosttyTerminal() throws {
        var terminal: GhosttyHandle = nil
        var renderState: GhosttyHandle = nil
        let options = GhosttyTerminalOptions(cols: geometry.cols, rows: geometry.rows, maxScrollback: 10_000)
        guard ghostty_terminal_new(nil, &terminal, options) == ghosttySuccess else { throw TerminalError.operationFailed("ghostty_terminal_new") }
        guard ghostty_render_state_new(nil, &renderState) == ghosttySuccess else { throw TerminalError.operationFailed("ghostty_render_state_new") }
        self.terminal = terminal
        self.renderState = renderState
        let userdata = Unmanaged.passUnretained(self).toOpaque()
        _ = ghostty_terminal_set(terminal, ghosttyTerminalOptUserdata, UnsafeRawPointer(userdata))
        _ = ghostty_terminal_set(terminal, ghosttyTerminalOptWritePTY, unsafeBitCast(ghosttyWritePTYCallback as @convention(c) (GhosttyHandle, UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int) -> Void, to: UnsafeRawPointer.self))
        _ = ghostty_terminal_resize(terminal, geometry.cols, geometry.rows, geometry.cellWidth, geometry.cellHeight)
    }

    private func spawnShell() throws {
        var master: Int32 = -1
        var window = winsize(ws_row: geometry.rows, ws_col: geometry.cols, ws_xpixel: geometry.cols * UInt16(geometry.cellWidth), ws_ypixel: geometry.rows * UInt16(geometry.cellHeight))
        let pid = forkpty(&master, nil, nil, &window)
        if pid < 0 { throw TerminalError.operationFailed("forkpty: \(String(cString: strerror(errno)))") }
        if pid == 0 { launchChildProcess() }
        let flags = fcntl(master, F_GETFL)
        if flags >= 0 {
            _ = fcntl(master, F_SETFL, flags | O_NONBLOCK)
        }
        childPID = pid
        masterFileDescriptor = master
    }

    private func launchChildProcess() -> Never {
        setenv("TERM", "xterm-256color", 1)
        setenv("COLORTERM", "truecolor", 1)
        setenv("TERM_PROGRAM", "ghostty", 1)
        setenv("TERM_PROGRAM_VERSION", "otto", 1)
        chdir(workingDirectory)
        let shellName = URL(fileURLWithPath: shellPath).lastPathComponent
        let argv0 = "-\(shellName)"
        let args = command.map { [argv0, "-lc", $0] } ?? [argv0]
        var cArgs = args.map { strdup($0) }
        cArgs.append(nil)
        execv(shellPath, &cArgs)
        _exit(127)
    }

    private func startReadingOutput() {
        let source = DispatchSource.makeReadSource(fileDescriptor: masterFileDescriptor, queue: .global(qos: .userInitiated))
        source.setEventHandler { [weak self] in
            guard let self else { return }
            var buffer = [UInt8](repeating: 0, count: 8192)
            let count = Darwin.read(self.masterFileDescriptor, &buffer, buffer.count)
            if count > 0 {
                self.lock.lock()
                if let terminal = self.terminal {
                    buffer.withUnsafeBufferPointer { ptr in
                        ghostty_terminal_vt_write(terminal, ptr.baseAddress!, count)
                    }
                }
                self.lock.unlock()
                DispatchQueue.main.async { [weak self] in
                    self?.redrawHandler?()
                }
            } else if count == 0 || errno != EAGAIN {
                DispatchQueue.main.async { [weak self] in
                    self?.isRunning = false
                }
            }
        }
        readSource = source
        source.resume()
    }

    private func drawCursor(
        renderState: GhosttyHandle,
        cellWidth: CGFloat,
        cellHeight: CGFloat,
        originX: CGFloat,
        originY: CGFloat,
        foreground: GhosttyColorRGB
    ) {
        var visible = false
        var hasValue = false
        var shape: CInt = 1
        var x: UInt16 = 0
        var y: UInt16 = 0
        _ = ghostty_render_state_get(renderState, ghosttyRenderStateDataCursorVisible, &visible)
        _ = ghostty_render_state_get(renderState, ghosttyRenderStateDataCursorViewportHasValue, &hasValue)
        _ = ghostty_render_state_get(renderState, ghosttyRenderStateDataCursorVisualStyle, &shape)
        guard visible, hasValue else { return }
        _ = ghostty_render_state_get(renderState, ghosttyRenderStateDataCursorViewportX, &x)
        _ = ghostty_render_state_get(renderState, ghosttyRenderStateDataCursorViewportY, &y)
        let rect = CGRect(
            x: originX + (CGFloat(x) * cellWidth),
            y: originY + (CGFloat(y) * cellHeight),
            width: cellWidth,
            height: cellHeight
        )
        nsColor(foreground).withAlphaComponent(0.85).setFill()
        if shape == 2 {
            CGRect(x: rect.minX, y: rect.maxY - 2, width: rect.width, height: 2).fill()
        } else if shape == 0 {
            CGRect(x: rect.minX, y: rect.minY, width: 2, height: rect.height).fill()
        } else if shape == 3 {
            NSBezierPath(rect: rect).stroke()
        } else {
            rect.fill()
        }
    }

    private func readRenderColor(_ renderState: GhosttyHandle, _ data: CInt, fallback: GhosttyColorRGB) -> GhosttyColorRGB {
        var color = fallback
        if ghostty_render_state_get(renderState, data, &color) == ghosttySuccess {
            return color
        }
        return fallback
    }

    private func nsColor(_ rgb: GhosttyColorRGB) -> NSColor {
        NSColor(calibratedRed: CGFloat(rgb.r) / 255, green: CGFloat(rgb.g) / 255, blue: CGFloat(rgb.b) / 255, alpha: 1)
    }

    private static func resolveUserShellPath() -> String {
        if let shell = ProcessInfo.processInfo.environment["SHELL"], !shell.isEmpty {
            return shell
        }
        if let passwd = getpwuid(geteuid()), let shell = passwd.pointee.pw_shell {
            let value = String(cString: shell)
            if !value.isEmpty { return value }
        }
        return "/bin/sh"
    }
}

private enum TerminalFont {
    struct Metrics {
        var font: NSFont
        var cellWidth: CGFloat
        var cellHeight: CGFloat
        var baselineOffset: CGFloat
    }

    private static var didRegisterFonts = false

    static func regular(size: CGFloat) -> NSFont {
        registerFontsIfNeeded()
        for family in ["JetBrainsMono NF", "JetBrainsMono Nerd Font", "JetBrainsMono Nerd Font Mono"] {
            if let font = NSFont(name: family, size: size) {
                return font
            }
        }
        return NSFont.userFixedPitchFont(ofSize: size) ?? NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
    }

    static func metrics(size: CGFloat) -> Metrics {
        let font = regular(size: size)
        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        let probeSize = NSString(string: "M").size(withAttributes: attributes)
        let maxAdvance = font.maximumAdvancement
        let lineHeight = ceil(max(probeSize.height, CGFloat(16)))
        let cellWidth = ceil(max(probeSize.width, maxAdvance.width, CGFloat(8)))
        let cellHeight = ceil(max(lineHeight + 4, CGFloat(16)))
        let baselineOffset = floor(max((cellHeight - lineHeight) / 2, 1))
        return Metrics(font: font, cellWidth: cellWidth, cellHeight: cellHeight, baselineOffset: baselineOffset)
    }

    private static func registerFontsIfNeeded() {
        guard !didRegisterFonts else { return }
        didRegisterFonts = true

        let sourceFileRepoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let currentRepoRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let fontDirectories = [
            Bundle.main.resourceURL?.appendingPathComponent("fonts"),
            Bundle.main.resourceURL?.appendingPathComponent("resources/fonts"),
            sourceFileRepoRoot.appendingPathComponent("apps/canvas/src-tauri/resources/fonts"),
            sourceFileRepoRoot.appendingPathComponent("vendor/ghostty/src/font/res"),
            currentRepoRoot.appendingPathComponent("apps/canvas/src-tauri/resources/fonts"),
            currentRepoRoot.appendingPathComponent("vendor/ghostty/src/font/res")
        ]
        let fontFiles = [
            "JetBrainsMonoNerdFont-Regular.ttf",
            "JetBrainsMonoNerdFont-Bold.ttf",
            "JetBrainsMonoNerdFont-Italic.ttf",
            "JetBrainsMonoNerdFont-BoldItalic.ttf"
        ]

        for directory in fontDirectories.compactMap(\.self) {
            for file in fontFiles {
                let url = directory.appendingPathComponent(file)
                guard FileManager.default.fileExists(atPath: url.path) else { continue }
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }
}

private enum TerminalError: LocalizedError {
    case operationFailed(String)

    var errorDescription: String? {
        switch self {
        case .operationFailed(let operation): "\(operation) failed"
        }
    }
}
