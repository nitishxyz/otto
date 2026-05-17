import SwiftUI

struct WorkspaceRail: View {
    @Bindable var model: AppModel
    var showsShortcutNumbers = false

    @State private var isAddWorkspaceHovered = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(Array(model.workspaces.enumerated()), id: \.element.id) { index, workspace in
                        WorkspaceRailButton(
                            workspace: workspace,
                            isActive: workspace.id == model.selectedWorkspaceID,
                            shortcutNumber: index + 1,
                            showsShortcutNumber: showsShortcutNumbers && index < 9,
                            action: { model.selectWorkspace(workspace) },
                            onRemove: { model.removeWorkspace(workspace) }
                        )
                    }
                }
                .padding(.top, 10)
            }

            Spacer(minLength: 8)

            Button {
                model.addWorkspaceFromOpenPanel()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(isAddWorkspaceHovered ? Color.primary.opacity(0.10) : Color.primary.opacity(0.06))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(isAddWorkspaceHovered ? Color.accentColor.opacity(0.35) : Color.clear, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .pressableCursor()
            .onHover { isAddWorkspaceHovered = $0 }
            .help("Add workspace")
            .padding(.bottom, 12)
        }
        .frame(maxHeight: .infinity)
    }
}

private struct WorkspaceRailButton: View {
    let workspace: Workspace
    let isActive: Bool
    let shortcutNumber: Int
    let showsShortcutNumber: Bool
    let action: () -> Void
    let onRemove: () -> Void

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
                    if showsShortcutNumber {
                        shortcutBadge
                            .transition(.scale(scale: 0.8).combined(with: .opacity))
                    }
                }
                .frame(width: 36, height: 36)
                .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isActive)
                .animation(.easeOut(duration: 0.12), value: showsShortcutNumber)
            }
            .buttonStyle(.plain)
            .pressableCursor()
            .onHover { isHovered = $0 }
            .help("\(workspace.name)\n\(workspace.path)")
            .contextMenu {
                Button("Forget Workspace", role: .destructive, action: onRemove)
            }

            Spacer(minLength: 0)

            Color.clear.frame(width: 3)
        }
        .frame(width: 56, height: 40)
    }

    private var shortcutBadge: some View {
        Text("\(shortcutNumber)")
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundStyle(Color.primary)
            .frame(width: 15, height: 15)
            .background(
                Circle()
                    .fill(.regularMaterial)
                    .shadow(color: Color.black.opacity(0.24), radius: 2, y: 1)
            )
            .overlay(
                Circle()
                    .stroke(Color.white.opacity(0.45), lineWidth: 0.5)
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .offset(x: 3, y: 3)
    }
}
