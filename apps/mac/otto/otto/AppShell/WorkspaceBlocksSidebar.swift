import SwiftUI

struct WorkspaceBlocksSidebar: View {
    @Bindable var model: AppModel
    @State private var isAddBlockHovered = false

    var body: some View {
        VStack(spacing: 0) {
            if model.selectedWorkspace != nil {
                blockList
                addBlockButton
            } else {
                Spacer()
                Text("No workspace selected")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Spacer()
            }
        }
    }

    private var blockList: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(BlockGroup.allCases) { group in
                    let groupBlocks = model.selectedWorkspace?.blocks.filter { $0.kind.group == group } ?? []
                    if !groupBlocks.isEmpty {
                        BlockGroupSection(
                            group: group,
                            blocks: groupBlocks,
                            selectedBlockID: model.selectedBlockID,
                            shortcuts: blockShortcuts,
                            onSelect: { model.selectBlock($0) }
                        )
                    }
                }
            }
            .padding(.top, 10)
            .padding(.bottom, 10)
        }
    }

    private var blockShortcuts: [CanvasBlock.ID: Int] {
        Dictionary(uniqueKeysWithValues: model.selectedWorkspaceSidebarBlocks.prefix(9).enumerated().map { index, block in
            (block.id, index + 1)
        })
    }

    private var addBlockButton: some View {
        Button {
            model.beginWorkspaceBlockCreation()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                Text("New Block")
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .frame(height: 36)
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
        .keyboardShortcut("n", modifiers: .command)
        .help("New block (⌘N)")
        .padding(.horizontal, 10)
        .padding(.bottom, 12)
    }
}

private struct BlockGroupSection: View {
    let group: BlockGroup
    let blocks: [CanvasBlock]
    let selectedBlockID: CanvasBlock.ID?
    let shortcuts: [CanvasBlock.ID: Int]
    let onSelect: (CanvasBlock) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(group.label.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(.tertiary)
                Spacer()
                Text("\(blocks.count)")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 2)

            VStack(spacing: 1) {
                ForEach(blocks) { block in
                    BlockSidebarRow(
                        block: block,
                        isSelected: block.id == selectedBlockID,
                        shortcut: shortcuts[block.id],
                        action: { onSelect(block) }
                    )
                }
            }
        }
    }
}

private struct BlockSidebarRow: View {
    let block: CanvasBlock
    let isSelected: Bool
    let shortcut: Int?
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                BlockKindIcon(kind: block.kind, size: 13)
                    .foregroundStyle(isSelected ? Color.white : .secondary)
                    .frame(width: 18, height: 18)

                VStack(alignment: .leading, spacing: 1) {
                    Text(block.title)
                        .font(.system(size: 12, weight: isSelected ? .semibold : .regular))
                        .foregroundStyle(isSelected ? Color.white : Color.primary)
                        .lineLimit(1)
                    Text(block.subtitle)
                        .font(.system(size: 10))
                        .foregroundStyle(isSelected ? Color.white.opacity(0.75) : .secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                if let shortcut {
                    Text("⌘\(shortcut)")
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundStyle(isSelected ? Color.white.opacity(0.72) : .secondary.opacity(0.7))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 4)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(isSelected ? Color.white.opacity(0.14) : Color.primary.opacity(0.05))
                        )
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(rowBackground)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .pressableCursor()
        .onHover { isHovered = $0 }
        .padding(.horizontal, 8)
    }

    @ViewBuilder
    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(
                isSelected
                    ? Color.accentColor.opacity(0.85)
                    : (isHovered ? Color.primary.opacity(0.06) : Color.clear)
            )
    }
}
