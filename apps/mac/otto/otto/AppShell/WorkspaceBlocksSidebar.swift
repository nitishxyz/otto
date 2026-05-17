import SwiftUI

struct WorkspaceBlocksSidebar: View {
    @Bindable var model: AppModel

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
                            onSelect: { model.selectBlock($0) }
                        )
                    }
                }
            }
            .padding(.top, 10)
            .padding(.bottom, 10)
        }
    }

    private var addBlockButton: some View {
        Button {
            model.beginBlockCreation()
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
                    .fill(Color.primary.opacity(0.06))
            )
        }
        .buttonStyle(.plain)
        .keyboardShortcut("n", modifiers: .command)
        .help("New block (⌘N)")
        .padding(.horizontal, 10)
        .padding(.bottom, 10)
    }
}

private struct BlockGroupSection: View {
    let group: BlockGroup
    let blocks: [CanvasBlock]
    let selectedBlockID: CanvasBlock.ID?
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
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: block.kind.symbolName)
                    .font(.system(size: 13))
                    .frame(width: 18, height: 18)
                    .foregroundStyle(isSelected ? Color.white : .secondary)

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
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(rowBackground)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
