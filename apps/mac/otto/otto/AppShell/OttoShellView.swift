import AppKit
import SwiftUI

struct OttoShellView: View {
    @Bindable var model: AppModel
    @State private var showsWorkspaceShortcutNumbers = false
    @State private var modifierMonitor: Any?
    @State private var shortcutMonitor: Any?

    var body: some View {
        HStack(spacing: 10) {
            floatingSidebar

            WorkspaceContentView(model: model)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.trailing, 8)
        .padding(.bottom, 8)
        .frame(minWidth: 980, minHeight: 640)
        .background(.regularMaterial)
        .background(ToolbarFlexibleSpaceInstaller())
        .onAppear {
            startModifierMonitor()
            startShortcutMonitor()
        }
        .onDisappear {
            stopModifierMonitor()
            stopShortcutMonitor()
        }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button(action: toggleSidebar) {
                    Image(systemName: model.isSidebarCollapsed ? "sidebar.right" : "sidebar.left")
                }
                .pressableCursor()
                .help("Toggle sidebar (⌘B)")
            }

            ToolbarItemGroup(placement: .primaryAction) {
                if let workspace = model.selectedWorkspace {
                    ProjectPathText(path: workspace.path)
                }

                Button(currentBlockLabel) {}
                    .pressableCursor()
                    .help("Current block")

                Button {
                    model.beginWorkspaceBlockCreation()
                } label: {
                    Label("New Tab", systemImage: "plus")
                }
                .pressableCursor()
                .help("New tab (⌘N)")

                Button {} label: {
                    Label("Export", systemImage: "square.and.arrow.up")
                }
                .pressableCursor()
                .help("Export")
            }
        }
    }

    private var floatingSidebar: some View {
        HStack(spacing: 0) {
            if model.isSidebarCollapsed {
                CollapsedBlockRail(model: model)
                    .frame(width: 58)
                    .transition(.opacity)
            } else {
                WorkspaceRail(
                    model: model,
                    showsShortcutNumbers: showsWorkspaceShortcutNumbers
                )
                    .frame(width: 58)

                Divider()
                    .opacity(0.42)
                    .padding(.vertical, 14)

                WorkspaceBlocksSidebar(model: model)
                    .frame(width: 260)
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .frame(width: model.isSidebarCollapsed ? 58 : 319)
        .frame(maxHeight: .infinity)
        .background {
            RoundedRectangle(cornerRadius: sidebarCornerRadius, style: .continuous)
                .fill(.ultraThinMaterial)
            RoundedRectangle(cornerRadius: sidebarCornerRadius, style: .continuous)
                .fill(Color.primary.opacity(0.035))
        }
        .overlay(
            RoundedRectangle(cornerRadius: sidebarCornerRadius, style: .continuous)
                .stroke(Color.primary.opacity(0.12), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: sidebarCornerRadius, style: .continuous))
        .shadow(color: Color.black.opacity(0.18), radius: 22, x: 0, y: 16)
        .padding(.leading, 8)
        .padding(.vertical, 8)
        .animation(.easeInOut(duration: 0.2), value: model.isSidebarCollapsed)
    }

    private var sidebarCornerRadius: CGFloat {
        model.isSidebarCollapsed ? 16 : 26
    }

    private var currentBlockLabel: String {
        if model.isBlockPickerPresented { return "New Tab" }
        guard let workspace = model.selectedWorkspace,
              let blockID = model.selectedBlockID,
              let block = workspace.blocks.first(where: { $0.id == blockID })
        else { return "No Block" }
        return block.title
    }

    private func toggleSidebar() {
        withAnimation(.easeInOut(duration: 0.2)) {
            model.toggleSidebar()
        }
    }

    private func startModifierMonitor() {
        guard modifierMonitor == nil else { return }
        modifierMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { event in
            updateWorkspaceShortcutNumbers(for: event.modifierFlags)
            return event
        }
        updateWorkspaceShortcutNumbers(for: NSEvent.modifierFlags)
    }

    private func startShortcutMonitor() {
        guard shortcutMonitor == nil else { return }
        shortcutMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            handleShortcut(event) ? nil : event
        }
    }

    private func stopModifierMonitor() {
        if let modifierMonitor {
            NSEvent.removeMonitor(modifierMonitor)
            self.modifierMonitor = nil
        }
        showsWorkspaceShortcutNumbers = false
    }

    private func stopShortcutMonitor() {
        if let shortcutMonitor {
            NSEvent.removeMonitor(shortcutMonitor)
            self.shortcutMonitor = nil
        }
    }

    private func handleShortcut(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
        let hasCommand = flags.contains(.command)
        let hasOption = flags.contains(.option)
        let hasControl = flags.contains(.control)
        let hasShift = flags.contains(.shift)

        if hasCommand && hasOption && !hasControl && !hasShift {
            if key == "]" {
                model.selectWorkspace(offset: 1)
                return true
            }
            if key == "[" {
                model.selectWorkspace(offset: -1)
                return true
            }
            if let index = shortcutNumberIndex(for: key) {
                model.selectWorkspace(at: index)
                return true
            }
        }

        if hasCommand && !hasOption && !hasControl {
            if !hasShift {
                switch key {
                case "o":
                    model.addWorkspaceFromOpenPanel()
                    return true
                case "n":
                    model.beginWorkspaceBlockCreation()
                    return true
                case "w":
                    model.closeSelectedBlock()
                    return true
                case "b":
                    toggleSidebar()
                    return true
                case "]":
                    model.selectNextBlock()
                    return true
                case "[":
                    model.selectPreviousBlock()
                    return true
                case "d":
                    model.beginSelectedCanvasSplit(direction: .horizontal)
                    return true
                case "h":
                    model.focusCanvasChild(direction: .left)
                    return true
                case "j":
                    model.focusCanvasChild(direction: .down)
                    return true
                case "k":
                    model.focusCanvasChild(direction: .up)
                    return true
                case "l":
                    model.focusCanvasChild(direction: .right)
                    return true
                default:
                    if let index = shortcutNumberIndex(for: key) {
                        model.selectBlock(at: index)
                        return true
                    }
                }
            } else if key == "d" {
                model.beginSelectedCanvasSplit(direction: .vertical)
                return true
            }
        }

        if hasControl && !hasCommand && !hasOption {
            if !hasShift && event.keyCode == 48 {
                model.selectRecentBlock()
                return true
            }
            if hasShift, let index = shortcutNumberIndex(for: key) {
                model.focusCanvasChild(at: index)
                return true
            }
        }

        return false
    }

    private func shortcutNumberIndex(for key: String) -> Int? {
        guard let value = Int(key), (1...9).contains(value) else { return nil }
        return value - 1
    }

    private func updateWorkspaceShortcutNumbers(for flags: NSEvent.ModifierFlags) {
        let relevantFlags = flags.intersection(.deviceIndependentFlagsMask)
        showsWorkspaceShortcutNumbers = relevantFlags.contains(.command) && relevantFlags.contains(.option)
    }
}

#Preview {
    OttoShellView(model: AppModel())
}

private struct ToolbarFlexibleSpaceInstaller: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        scheduleInstall(from: view)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        scheduleInstall(from: nsView)
    }

    private func scheduleInstall(from view: NSView, attempt: Int = 0) {
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(50)) {
            guard let toolbar = view.window?.toolbar else {
                if attempt < 20 {
                    scheduleInstall(from: view, attempt: attempt + 1)
                }
                return
            }

            guard !toolbar.items.contains(where: { $0.itemIdentifier == .flexibleSpace }) else { return }
            toolbar.insertItem(withItemIdentifier: .flexibleSpace, at: min(1, toolbar.items.count))
        }
    }
}

private struct ProjectPathText: View {
    let path: String

    var body: some View {
        Text(path)
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.middle)
            .frame(maxWidth: 280, alignment: .trailing)
            .padding(.horizontal, 8)
            .help(path)
    }
}

private struct CollapsedBlockRail: View {
    @Bindable var model: AppModel
    @State private var isAddBlockHovered = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(model.selectedWorkspaceSidebarBlocks) { block in
                        CollapsedBlockRailButton(
                            block: block,
                            isActive: block.id == model.selectedBlockID,
                            action: { model.selectBlock(block) }
                        )
                    }
                }
                .padding(.top, 10)
            }

            Spacer(minLength: 8)

            Button {
                model.beginWorkspaceBlockCreation()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(isAddBlockHovered ? Color.primary.opacity(0.10) : Color.primary.opacity(0.06))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(isAddBlockHovered ? Color.accentColor.opacity(0.35) : Color.clear, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .pressableCursor()
            .onHover { isAddBlockHovered = $0 }
            .help("New block")
            .padding(.bottom, 12)
        }
        .frame(maxHeight: .infinity)
    }
}

private struct CollapsedBlockRailButton: View {
    let block: CanvasBlock
    let isActive: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(Color.primary)
                .frame(width: 3, height: isActive ? 22 : (isHovered ? 10 : 0))
                .opacity(isActive ? 1 : (isHovered ? 0.5 : 0))
                .animation(.easeOut(duration: 0.15), value: isActive)
                .animation(.easeOut(duration: 0.15), value: isHovered)

            Spacer(minLength: 0)

            Button(action: action) {
                ZStack {
                    RoundedRectangle(cornerRadius: isActive ? 11 : 14, style: .continuous)
                        .fill(isActive ? Color.accentColor.opacity(0.88) : Color.primary.opacity(isHovered ? 0.12 : 0.07))
                    BlockKindIcon(kind: block.kind, size: 15)
                        .foregroundStyle(isActive ? Color.white : .secondary)
                }
                .frame(width: 36, height: 36)
                .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isActive)
            }
            .buttonStyle(.plain)
            .pressableCursor()
            .onHover { isHovered = $0 }
            .help("\(block.title)\n\(block.subtitle)")

            Spacer(minLength: 0)

            Color.clear.frame(width: 3)
        }
        .frame(width: 56, height: 40)
    }
}
