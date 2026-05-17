import SwiftUI

struct CustomCommandModalView: View {
    let onSubmit: (String, String) -> Void
    let onCancel: () -> Void

    @State private var label = ""
    @State private var command = ""
    @FocusState private var focusedField: Field?

    private enum Field {
        case label
        case command
    }

    private var canSubmit: Bool {
        !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 16) {
            VStack(spacing: 8) {
                Image(systemName: "play.rectangle")
                    .font(.system(size: 24, weight: .regular))
                    .foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.primary.opacity(0.07))
                    )

                VStack(spacing: 4) {
                    Text("Custom Command")
                        .font(.system(size: 20, weight: .semibold))
                    Text("Run a shell command in a terminal-backed block.")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Label")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(.tertiary)
                    TextField("Frontend dev", text: $label)
                        .textFieldStyle(.plain)
                        .focused($focusedField, equals: .label)
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .background(fieldBackground)
                }

                VStack(alignment: .leading, spacing: 5) {
                    Text("Command")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(.tertiary)
                    TextField("bun run dev", text: $command)
                        .textFieldStyle(.plain)
                        .focused($focusedField, equals: .command)
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .background(fieldBackground)
                        .onSubmit(submit)
                    Text("Runs from the current workspace terminal environment.")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
            }

            HStack(spacing: 8) {
                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.escape, modifiers: [])
                Spacer()
                Button("Run Command", action: submit)
                    .keyboardShortcut(.return, modifiers: [])
                    .disabled(!canSubmit)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .frame(width: 420)
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
        .onAppear { focusedField = .command }
        .onExitCommand(perform: onCancel)
    }

    private var fieldBackground: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Color.primary.opacity(0.05))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.primary.opacity(0.10), lineWidth: 1)
            )
    }

    private func submit() {
        guard canSubmit else { return }
        onSubmit(label, command)
    }
}

#Preview {
    CustomCommandModalView(
        onSubmit: { _, _ in },
        onCancel: {}
    )
}
