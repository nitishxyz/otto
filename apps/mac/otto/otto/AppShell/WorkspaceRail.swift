import SwiftUI

struct WorkspaceRail: View {
    @Bindable var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(model.workspaces) { workspace in
                        WorkspaceRailButton(
                            workspace: workspace,
                            isActive: workspace.id == model.selectedWorkspaceID,
                            action: { model.selectWorkspace(workspace) }
                        )
                    }
                }
                .padding(.top, 10)
            }

            Spacer(minLength: 8)

            Button {
                // Hook to NSOpenPanel next
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(Color.primary.opacity(0.06))
                    )
            }
            .buttonStyle(.plain)
            .help("Add workspace")
            .padding(.bottom, 12)
        }
        .frame(maxHeight: .infinity)
    }
}

private struct WorkspaceRailButton: View {
    let workspace: Workspace
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
                        .fill(workspace.accent.color)
                        .shadow(color: workspace.accent.color.opacity(isActive ? 0.35 : 0), radius: 6, y: 2)
                    Text(workspace.initials)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                }
                .frame(width: 36, height: 36)
                .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isActive)
            }
            .buttonStyle(.plain)
            .onHover { isHovered = $0 }
            .help("\(workspace.name)\n\(workspace.path)")

            Spacer(minLength: 0)

            Color.clear.frame(width: 3)
        }
        .frame(width: 56, height: 40)
    }
}
