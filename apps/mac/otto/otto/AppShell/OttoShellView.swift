import SwiftUI

struct OttoShellView: View {
    @Bindable var model: AppModel
    @State private var sidebarCollapsed = false

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
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button(action: toggleSidebar) {
                    Image(systemName: sidebarCollapsed ? "sidebar.right" : "sidebar.left")
                }
                .pressableCursor()
                .help("Toggle sidebar")
            }

            ToolbarSpacer(.flexible, placement: .primaryAction)

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
            if sidebarCollapsed {
                CollapsedBlockRail(model: model)
                    .frame(width: 58)
                    .transition(.opacity)
            } else {
                WorkspaceRail(model: model)
                    .frame(width: 58)

                Divider()
                    .opacity(0.42)
                    .padding(.vertical, 14)

                WorkspaceBlocksSidebar(model: model)
                    .frame(width: 260)
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .frame(width: sidebarCollapsed ? 58 : 319)
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
        .animation(.easeInOut(duration: 0.2), value: sidebarCollapsed)
    }

    private var sidebarCornerRadius: CGFloat {
        sidebarCollapsed ? 16 : 26
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
            sidebarCollapsed.toggle()
        }
    }
}

#Preview {
    OttoShellView(model: AppModel())
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
