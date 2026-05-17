import SwiftUI
import AppKit

struct BlockPickerView: View {
    let options: [BlockCreationOption]
    let onSelect: (BlockCreationOption) -> Void
    let onCancel: () -> Void

    private let columns = [
        GridItem(.adaptive(minimum: 132, maximum: 132), spacing: 8, alignment: .top)
    ]

    var body: some View {
        VStack(spacing: 16) {
            Text("New Block")
                .font(.system(size: 20, weight: .semibold))

            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(options) { option in
                    BlockPickerCard(option: option) {
                        onSelect(option)
                    }
                }
            }
            .frame(maxWidth: 720)

            Text("number to select · esc to cancel")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.tertiary)
        }
        .padding(24)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(.regularMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(Color.primary.opacity(0.12), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.24), radius: 28, y: 16)
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(EscapeKeyMonitor(onEscape: onCancel).frame(width: 0, height: 0))
        .onExitCommand(perform: onCancel)
    }
}

private struct EscapeKeyMonitor: NSViewRepresentable {
    let onEscape: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onEscape: onEscape)
    }

    func makeNSView(context: Context) -> NSView {
        context.coordinator.install()
        return NSView(frame: .zero)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.onEscape = onEscape
        context.coordinator.install()
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    final class Coordinator {
        var onEscape: () -> Void
        private var monitor: Any?

        init(onEscape: @escaping () -> Void) {
            self.onEscape = onEscape
        }

        func install() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard event.keyCode == 53 else { return event }
                self?.onEscape()
                return nil
            }
        }

        func uninstall() {
            if let monitor {
                NSEvent.removeMonitor(monitor)
            }
            monitor = nil
        }
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
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .top) {
                    BlockKindIcon(kind: option.kind, size: 18)
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
                        .lineLimit(2)
                    Text(option.subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(12)
            .frame(width: 132, height: 118, alignment: .topLeading)
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
