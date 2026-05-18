import Foundation

struct CanvasBlock: Codable, Identifiable, Hashable {
    let id: UUID
    var kind: BlockKind
    var title: String
    var subtitle: String
    var launchCommand: String?
    var children: [CanvasBlock]
    var layout: CanvasLayoutNode?
    var focusedChildID: CanvasBlock.ID?
    var isPendingCreation: Bool

    init(
        id: UUID = UUID(),
        kind: BlockKind,
        title: String? = nil,
        subtitle: String? = nil,
        launchCommand: String? = nil,
        children: [CanvasBlock] = [],
        layout: CanvasLayoutNode? = nil,
        focusedChildID: CanvasBlock.ID? = nil,
        isPendingCreation: Bool = false
    ) {
        self.id = id
        self.kind = kind
        self.title = title ?? kind.defaultTitle
        self.subtitle = subtitle ?? kind.defaultSubtitle
        self.launchCommand = launchCommand ?? kind.defaultLaunchCommand
        self.children = children
        self.layout = layout ?? CanvasLayoutNode.layout(for: children)
        self.focusedChildID = focusedChildID ?? children.first?.id
        self.isPendingCreation = isPendingCreation
    }
}

enum SplitDirection: String, Codable, Hashable {
    case horizontal
    case vertical

    var opposite: SplitDirection {
        switch self {
        case .horizontal: .vertical
        case .vertical: .horizontal
        }
    }
}

enum CanvasFocusDirection: String, Hashable {
    case left
    case down
    case up
    case right
}

private struct CanvasLeafFrame: Hashable {
    let blockID: CanvasBlock.ID
    let minX: Double
    let minY: Double
    let maxX: Double
    let maxY: Double

    var midX: Double { (minX + maxX) / 2 }
    var midY: Double { (minY + maxY) / 2 }
}

indirect enum CanvasLayoutNode: Codable, Hashable {
    case leaf(blockID: CanvasBlock.ID)
    case split(
        id: UUID,
        direction: SplitDirection,
        ratio: Double,
        first: CanvasLayoutNode,
        second: CanvasLayoutNode
    )

    static func layout(for blocks: [CanvasBlock]) -> CanvasLayoutNode? {
        guard let first = blocks.first else { return nil }
        return blocks.dropFirst().reduce(CanvasLayoutNode.leaf(blockID: first.id)) { layout, block in
            CanvasLayoutNode.insert(
                blockID: block.id,
                into: layout,
                focusedID: CanvasLayoutNode.lastBlockID(in: layout),
                direction: nil
            )
        }
    }

    static func insert(
        blockID: CanvasBlock.ID,
        into layout: CanvasLayoutNode?,
        focusedID: CanvasBlock.ID?,
        direction: SplitDirection? = nil
    ) -> CanvasLayoutNode {
        let resolvedDirection = direction ?? pickDirection(layout: layout, focusedID: focusedID)
        guard let layout else { return .leaf(blockID: blockID) }
        guard let focusedID else {
            return .split(
                id: UUID(),
                direction: resolvedDirection,
                ratio: 0.5,
                first: layout,
                second: .leaf(blockID: blockID)
            )
        }
        return splitAtLeaf(layout, targetID: focusedID, newBlockID: blockID, direction: resolvedDirection)
    }

    static func remove(blockID: CanvasBlock.ID, from layout: CanvasLayoutNode?) -> CanvasLayoutNode? {
        guard let layout else { return nil }
        switch layout {
        case .leaf(let leafBlockID):
            return leafBlockID == blockID ? nil : layout
        case .split(let id, let direction, let ratio, let first, let second):
            let nextFirst = remove(blockID: blockID, from: first)
            let nextSecond = remove(blockID: blockID, from: second)
            if nextFirst == nil && nextSecond == nil { return nil }
            if nextFirst == nil { return nextSecond }
            if nextSecond == nil { return nextFirst }
            return .split(id: id, direction: direction, ratio: ratio, first: nextFirst!, second: nextSecond!)
        }
    }

    static func updateRatio(
        splitID: UUID,
        ratio: Double,
        in layout: CanvasLayoutNode
    ) -> CanvasLayoutNode {
        switch layout {
        case .leaf:
            return layout
        case .split(let id, let direction, _, let first, let second) where id == splitID:
            return .split(id: id, direction: direction, ratio: min(0.98, max(0.02, ratio)), first: first, second: second)
        case .split(let id, let direction, let currentRatio, let first, let second):
            return .split(
                id: id,
                direction: direction,
                ratio: currentRatio,
                first: updateRatio(splitID: splitID, ratio: ratio, in: first),
                second: updateRatio(splitID: splitID, ratio: ratio, in: second)
            )
        }
    }

    static func blockIDs(in layout: CanvasLayoutNode?) -> [CanvasBlock.ID] {
        guard let layout else { return [] }
        switch layout {
        case .leaf(let blockID):
            return [blockID]
        case .split(_, _, _, let first, let second):
            return blockIDs(in: first) + blockIDs(in: second)
        }
    }

    static func neighbor(
        from focusedID: CanvasBlock.ID,
        direction: CanvasFocusDirection,
        in layout: CanvasLayoutNode?
    ) -> CanvasBlock.ID? {
        let frames = leafFrames(in: layout)
        guard let focused = frames.first(where: { $0.blockID == focusedID }) else { return nil }
        return frames
            .filter { frame in
                guard frame.blockID != focusedID else { return false }
                switch direction {
                case .left:
                    return frame.midX < focused.midX && rangesOverlap(frame.minY...frame.maxY, focused.minY...focused.maxY)
                case .right:
                    return frame.midX > focused.midX && rangesOverlap(frame.minY...frame.maxY, focused.minY...focused.maxY)
                case .up:
                    return frame.midY < focused.midY && rangesOverlap(frame.minX...frame.maxX, focused.minX...focused.maxX)
                case .down:
                    return frame.midY > focused.midY && rangesOverlap(frame.minX...frame.maxX, focused.minX...focused.maxX)
                }
            }
            .min { lhs, rhs in
                directionalDistance(from: focused, to: lhs, direction: direction) < directionalDistance(from: focused, to: rhs, direction: direction)
            }?
            .blockID
    }

    private static func leafFrames(in layout: CanvasLayoutNode?) -> [CanvasLeafFrame] {
        guard let layout else { return [] }
        return leafFrames(in: layout, minX: 0, minY: 0, maxX: 1, maxY: 1)
    }

    private static func leafFrames(
        in node: CanvasLayoutNode,
        minX: Double,
        minY: Double,
        maxX: Double,
        maxY: Double
    ) -> [CanvasLeafFrame] {
        switch node {
        case .leaf(let blockID):
            return [CanvasLeafFrame(blockID: blockID, minX: minX, minY: minY, maxX: maxX, maxY: maxY)]
        case .split(_, .horizontal, let ratio, let first, let second):
            let splitX = minX + ((maxX - minX) * ratio)
            return leafFrames(in: first, minX: minX, minY: minY, maxX: splitX, maxY: maxY)
                + leafFrames(in: second, minX: splitX, minY: minY, maxX: maxX, maxY: maxY)
        case .split(_, .vertical, let ratio, let first, let second):
            let splitY = minY + ((maxY - minY) * ratio)
            return leafFrames(in: first, minX: minX, minY: minY, maxX: maxX, maxY: splitY)
                + leafFrames(in: second, minX: minX, minY: splitY, maxX: maxX, maxY: maxY)
        }
    }

    private static func rangesOverlap(_ lhs: ClosedRange<Double>, _ rhs: ClosedRange<Double>) -> Bool {
        min(lhs.upperBound, rhs.upperBound) > max(lhs.lowerBound, rhs.lowerBound)
    }

    private static func directionalDistance(
        from focused: CanvasLeafFrame,
        to candidate: CanvasLeafFrame,
        direction: CanvasFocusDirection
    ) -> Double {
        switch direction {
        case .left, .right:
            return abs(candidate.midX - focused.midX) + (abs(candidate.midY - focused.midY) * 0.25)
        case .up, .down:
            return abs(candidate.midY - focused.midY) + (abs(candidate.midX - focused.midX) * 0.25)
        }
    }

    private static func splitAtLeaf(
        _ node: CanvasLayoutNode,
        targetID: CanvasBlock.ID,
        newBlockID: CanvasBlock.ID,
        direction: SplitDirection
    ) -> CanvasLayoutNode {
        switch node {
        case .leaf(let blockID) where blockID == targetID:
            return .split(
                id: UUID(),
                direction: direction,
                ratio: 0.5,
                first: node,
                second: .leaf(blockID: newBlockID)
            )
        case .leaf:
            return node
        case .split(let id, let splitDirection, let ratio, let first, let second):
            return .split(
                id: id,
                direction: splitDirection,
                ratio: ratio,
                first: splitAtLeaf(first, targetID: targetID, newBlockID: newBlockID, direction: direction),
                second: splitAtLeaf(second, targetID: targetID, newBlockID: newBlockID, direction: direction)
            )
        }
    }

    private static func pickDirection(layout: CanvasLayoutNode?, focusedID: CanvasBlock.ID?) -> SplitDirection {
        guard let layout, let focusedID else { return .horizontal }
        return parentDirection(of: focusedID, in: layout)?.opposite ?? .horizontal
    }

    private static func parentDirection(of blockID: CanvasBlock.ID, in node: CanvasLayoutNode) -> SplitDirection? {
        switch node {
        case .leaf:
            return nil
        case .split(_, let direction, _, let first, let second):
            if contains(blockID: blockID, in: first) {
                return parentDirection(of: blockID, in: first) ?? direction
            }
            if contains(blockID: blockID, in: second) {
                return parentDirection(of: blockID, in: second) ?? direction
            }
            return nil
        }
    }

    private static func contains(blockID: CanvasBlock.ID, in node: CanvasLayoutNode) -> Bool {
        switch node {
        case .leaf(let id):
            return id == blockID
        case .split(_, _, _, let first, let second):
            return contains(blockID: blockID, in: first) || contains(blockID: blockID, in: second)
        }
    }

    private static func lastBlockID(in node: CanvasLayoutNode) -> CanvasBlock.ID? {
        switch node {
        case .leaf(let blockID):
            return blockID
        case .split(_, _, _, _, let second):
            return lastBlockID(in: second)
        }
    }
}

extension CanvasLayoutNode {
    private enum CodingKeys: String, CodingKey {
        case type
        case blockID
        case id
        case direction
        case ratio
        case first
        case second
    }

    private enum NodeType: String, Codable {
        case leaf
        case split
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(NodeType.self, forKey: .type)
        switch type {
        case .leaf:
            self = .leaf(blockID: try container.decode(CanvasBlock.ID.self, forKey: .blockID))
        case .split:
            self = .split(
                id: try container.decode(UUID.self, forKey: .id),
                direction: try container.decode(SplitDirection.self, forKey: .direction),
                ratio: try container.decode(Double.self, forKey: .ratio),
                first: try container.decode(CanvasLayoutNode.self, forKey: .first),
                second: try container.decode(CanvasLayoutNode.self, forKey: .second)
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .leaf(let blockID):
            try container.encode(NodeType.leaf, forKey: .type)
            try container.encode(blockID, forKey: .blockID)
        case .split(let id, let direction, let ratio, let first, let second):
            try container.encode(NodeType.split, forKey: .type)
            try container.encode(id, forKey: .id)
            try container.encode(direction, forKey: .direction)
            try container.encode(ratio, forKey: .ratio)
            try container.encode(first, forKey: .first)
            try container.encode(second, forKey: .second)
        }
    }
}

enum BlockKind: String, CaseIterable, Codable, Identifiable, Hashable {
    case canvas
    case otto
    case neovim
    case terminal
    case browser
    case command
    case claudeCode
    case codex
    case ottoTUI
    case openCode

    var id: String { rawValue }

    var defaultTitle: String {
        switch self {
        case .canvas: "Canvas"
        case .otto: "otto"
        case .neovim: "Neovim"
        case .terminal: "Ghostty"
        case .browser: "Browser"
        case .command: "Custom"
        case .claudeCode: "Claude Code"
        case .codex: "Codex"
        case .ottoTUI: "otto TUI"
        case .openCode: "OpenCode"
        }
    }

    var defaultSubtitle: String {
        switch self {
        case .canvas: "Multi-block workspace"
        case .otto: "Agent"
        case .neovim: "Editor"
        case .terminal: "Terminal"
        case .browser: "Web preview"
        case .command: "Shell command"
        case .claudeCode: "Agent"
        case .codex: "Agent"
        case .ottoTUI: "Agent"
        case .openCode: "Agent"
        }
    }

    var symbolName: String {
        switch self {
        case .canvas: "square.split.2x2"
        case .otto: "sparkles"
        case .neovim: "curlybraces.square"
        case .terminal: "terminal"
        case .browser: "safari"
        case .command: "play"
        case .claudeCode: "sparkle.magnifyingglass"
        case .codex: "brain.head.profile"
        case .ottoTUI: "sparkles.tv"
        case .openCode: "chevron.left.forwardslash.chevron.right"
        }
    }

    var group: BlockGroup {
        switch self {
        case .canvas: .workspace
        case .otto, .claudeCode, .codex, .ottoTUI, .openCode: .agents
        case .neovim: .editors
        case .terminal: .terminals
        case .browser: .browsers
        case .command: .commands
        }
    }

    var pickerDescription: String {
        switch self {
        case .canvas: "Arrange multiple otto, terminal, browser, and command surfaces."
        case .otto: "Open a native otto agent session."
        case .neovim: "Launch Neovim inside a terminal-backed surface."
        case .terminal: "Open a focused Ghostty-style terminal."
        case .browser: "Open a native web preview or docs browser."
        case .command: "Configure and run a shell command in a terminal surface."
        case .claudeCode: "Launch Claude Code inside a terminal-backed surface."
        case .codex: "Launch Codex inside a terminal-backed surface."
        case .ottoTUI: "Launch the otto terminal UI."
        case .openCode: "Launch OpenCode inside a terminal-backed surface."
        }
    }

    nonisolated var defaultLaunchCommand: String? {
        switch self {
        case .neovim: "nvim"
        case .claudeCode: "claude"
        case .codex: "codex"
        case .ottoTUI: "otto"
        case .openCode: "opencode"
        default: nil
        }
    }

    var runsInTerminal: Bool {
        switch self {
        case .terminal, .command, .neovim, .claudeCode, .codex, .ottoTUI, .openCode:
            true
        default:
            false
        }
    }
}

enum BlockGroup: String, CaseIterable, Identifiable, Hashable {
    case workspace
    case agents
    case editors
    case terminals
    case browsers
    case commands

    var id: String { rawValue }

    var label: String {
        switch self {
        case .workspace: "Workspace"
        case .agents: "Agents"
        case .editors: "Editors"
        case .terminals: "Terminals"
        case .browsers: "Browsers"
        case .commands: "Commands"
        }
    }
}

struct BlockCreationOption: Identifiable, Hashable {
    let kind: BlockKind
    let keyEquivalent: String?

    var id: BlockKind { kind }
    var title: String { kind.defaultTitle }
    var subtitle: String { kind.defaultSubtitle }
    var description: String { kind.pickerDescription }
    var symbolName: String { kind.symbolName }
}

enum BlockCatalog {
    private nonisolated static let creationKinds: [BlockKind] = [
        .terminal,
        .browser,
        .otto,
        .neovim,
        .claudeCode,
        .codex,
        .ottoTUI,
        .openCode,
        .command,
        .canvas
    ]

    nonisolated static var creationOptions: [BlockCreationOption] {
        creationOptions(includeCanvas: true)
    }

    nonisolated static func creationOptions(includeCanvas: Bool) -> [BlockCreationOption] {
        creationKinds
            .filter { includeCanvas || $0 != .canvas }
            .filter(isAvailableForCreation)
            .enumerated()
            .map { offset, kind in
                BlockCreationOption(kind: kind, keyEquivalent: String(offset + 1))
            }
    }

    nonisolated static func isAvailableForCreation(_ kind: BlockKind) -> Bool {
        guard let command = kind.defaultLaunchCommand else { return true }
        return ShellCommandAvailability.isAvailable(command)
    }
}

private enum ShellCommandAvailability {
    nonisolated static func isAvailable(_ command: String) -> Bool {
        let trimmedCommand = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCommand.isEmpty else { return false }

        if trimmedCommand.contains("/") {
            let expandedPath = (trimmedCommand as NSString).expandingTildeInPath
            return FileManager.default.isExecutableFile(atPath: expandedPath)
        }

        return searchDirectories.contains { directory in
            FileManager.default.isExecutableFile(atPath: "\(directory)/\(trimmedCommand)")
        }
    }

    private nonisolated static var searchDirectories: [String] {
        var directories: [String] = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin"
        ]
        let environment = ProcessInfo.processInfo.environment
        if let path = environment["PATH"] {
            directories.append(contentsOf: path.split(separator: ":").map(String.init))
        }
        if let home = environment["HOME"], !home.isEmpty {
            directories.append(contentsOf: [
                "\(home)/.bun/bin",
                "\(home)/.local/bin",
                "\(home)/.cargo/bin",
                "\(home)/.npm-global/bin"
            ])
        }
        return uniqueDirectories(directories)
    }

    private nonisolated static func uniqueDirectories(_ directories: [String]) -> [String] {
        var seen: Set<String> = []
        return directories.compactMap { directory in
            let expandedDirectory = (directory as NSString).expandingTildeInPath
            guard !expandedDirectory.isEmpty, !seen.contains(expandedDirectory) else { return nil }
            seen.insert(expandedDirectory)
            return expandedDirectory
        }
    }
}
