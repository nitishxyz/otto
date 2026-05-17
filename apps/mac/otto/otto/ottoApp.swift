//
//  ottoApp.swift
//  otto
//
//  Created by bat on 17/05/26.
//

import AppKit
import SwiftUI

@main
struct ottoApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            OttoShellView(model: model)
                .frame(minWidth: 980, minHeight: 640)
                .background(WindowMaterialConfigurator())
        }
        .windowToolbarStyle(.unified(showsTitle: false))
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .appVisibility) {}

            CommandGroup(after: .newItem) {
                Button("Open Workspace…") {
                    model.addWorkspaceFromOpenPanel()
                }
                .keyboardShortcut("o", modifiers: .command)

                Button("New Block") {
                    model.beginBlockCreation()
                }
                .keyboardShortcut("n", modifiers: .command)

                Button("Close Block") {
                    model.closeSelectedBlock()
                }
                .keyboardShortcut("w", modifiers: .command)
            }

            CommandMenu("Blocks") {
                Button("Next Block") {
                    model.selectNextBlock()
                }
                .keyboardShortcut("]", modifiers: .command)

                Button("Previous Block") {
                    model.selectPreviousBlock()
                }
                .keyboardShortcut("[", modifiers: .command)

                Divider()

                Button("Split Right") {
                    model.beginSelectedCanvasSplit(direction: .horizontal)
                }
                .keyboardShortcut("d", modifiers: .command)

                Button("Split Down") {
                    model.beginSelectedCanvasSplit(direction: .vertical)
                }
                .keyboardShortcut("d", modifiers: [.command, .shift])

                Divider()

                Button("Focus Left") {
                    model.focusCanvasChild(direction: .left)
                }
                .keyboardShortcut("h", modifiers: .command)

                Button("Focus Down") {
                    model.focusCanvasChild(direction: .down)
                }
                .keyboardShortcut("j", modifiers: .command)

                Button("Focus Up") {
                    model.focusCanvasChild(direction: .up)
                }
                .keyboardShortcut("k", modifiers: .command)

                Button("Focus Right") {
                    model.focusCanvasChild(direction: .right)
                }
                .keyboardShortcut("l", modifiers: .command)

                Divider()

                ForEach(0..<9, id: \.self) { index in
                    Button("Select Tab \(index + 1)") {
                        model.selectBlock(at: index)
                    }
                    .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
                }

                Divider()

                ForEach(0..<9, id: \.self) { index in
                    Button("Focus Canvas Block \(index + 1)") {
                        model.focusCanvasChild(at: index)
                    }
                    .keyboardShortcut(
                        KeyEquivalent(Character("\(index + 1)")),
                        modifiers: [.control, .shift]
                    )
                }
            }
        }
    }
}

private struct WindowMaterialConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async { configure(view.window) }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { configure(nsView.window) }
    }

    private func configure(_ window: NSWindow?) {
        guard let window else { return }
        window.isOpaque = false
        window.backgroundColor = .clear
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
    }
}
