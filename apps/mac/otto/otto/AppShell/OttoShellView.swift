import SwiftUI

struct OttoShellView: View {
    @Bindable var model: AppModel
    @State private var sidebarCollapsed = false

    var body: some View {
        HStack(spacing: 0) {
            WorkspaceRail(model: model)
                .frame(width: 58)

            if !sidebarCollapsed {
                WorkspaceBlocksSidebar(model: model)
                    .frame(width: 260)
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }

            WorkspaceContentView(model: model)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.trailing, 8)
        .padding(.bottom, 8)
        .frame(minWidth: 980, minHeight: 640)
        .background(.regularMaterial)
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button(action: toggleSidebar) {
                    Image(systemName: sidebarCollapsed ? "sidebar.right" : "sidebar.left")
                }
                .pressableCursor()
                .help("Toggle sidebar")

                if let workspace = model.selectedWorkspace {
                    HStack(spacing: 8) {
                        Text(workspace.name)
                            .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        Text(workspace.path)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .frame(minWidth: 260, alignment: .leading)
                }

                Button(currentBlockLabel) {}
                    .pressableCursor()
                    .help("Current block type")
            }

            ToolbarSpacer(.flexible, placement: .primaryAction)

            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    model.beginBlockCreation()
                } label: {
                    Label("New Block", systemImage: "plus")
                }
                .pressableCursor()
                .help("New block (⌘N)")

                Button {} label: {
                    Label("Export", systemImage: "square.and.arrow.up")
                }
                .pressableCursor()
                .help("Export")
            }
        }
    }

    private var currentBlockLabel: String {
        if model.isBlockPickerPresented { return "New Block" }
        guard let workspace = model.selectedWorkspace,
              let blockID = model.selectedBlockID,
              let block = workspace.blocks.first(where: { $0.id == blockID })
        else { return "No Block" }
        return block.kind.defaultTitle
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
