//
//  ottoApp.swift
//  otto
//
//  Created by bat on 17/05/26.
//

import SwiftUI

@main
struct ottoApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            OttoShellView(model: model)
                .frame(minWidth: 980, minHeight: 640)
        }
        .windowToolbarStyle(.unified(showsTitle: false))
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .appVisibility) {}

            CommandGroup(after: .newItem) {
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
