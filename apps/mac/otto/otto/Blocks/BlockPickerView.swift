import SwiftUI

struct BlockPickerView: View {
    let options: [BlockCreationOption]
    let onSelect: (BlockCreationOption) -> Void
    let onCancel: () -> Void

    private let columns = [
        GridItem(.adaptive(minimum: 132, maximum: 160), spacing: 8, alignment: .top)
    ]

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 6) {
                Text("New Block")
                    .font(.system(size: 20, weight: .semibold))
                Text("Choose the surface to add to this workspace.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(options) { option in
                    BlockPickerCard(option: option) {
                        onSelect(option)
                    }
                }
            }
            .frame(maxWidth: 720)

            Text("press number to select · esc to cancel")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.tertiary)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onExitCommand(perform: onCancel)
    }
}

private struct BlockPickerCard: View {
    let option: BlockCreationOption
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        if let keyboardShortcut {
            cardButton
                .keyboardShortcut(keyboardShortcut, modifiers: [])
        } else {
            cardButton
        }
    }

    private var cardButton: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Image(systemName: option.symbolName)
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 32, height: 32)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color.primary.opacity(0.06))
                        )

                    Spacer()

                    if let keyEquivalent = option.keyEquivalent {
                        Text(keyEquivalent)
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(Color.primary.opacity(0.05))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .stroke(Color.primary.opacity(0.08), lineWidth: 1)
                            )
                    }
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(option.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.primary)
                    Text(option.description)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 124, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(isHovered ? Color.primary.opacity(0.07) : Color.primary.opacity(0.035))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isHovered ? Color.accentColor.opacity(0.35) : Color.primary.opacity(0.08), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }

    private var keyboardShortcut: KeyEquivalent? {
        guard let keyEquivalent = option.keyEquivalent,
              let character = keyEquivalent.first
        else { return nil }
        return KeyEquivalent(character)
    }
}

#Preview {
    BlockPickerView(
        options: BlockCatalog.creationOptions,
        onSelect: { _ in },
        onCancel: {}
    )
}
