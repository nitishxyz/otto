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
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    var body: some Scene {
        Window("otto", id: "main") {
            OttoShellView(model: model)
                .frame(minWidth: 980, minHeight: 640)
                .background(WindowMaterialConfigurator())
                .onAppear {
                    appDelegate.model = model
                }
        }
        .windowToolbarStyle(.unified(showsTitle: false))
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .appVisibility) {}

            CommandGroup(replacing: .newItem) {
                Button("Open Workspace…") {
                    model.addWorkspaceFromOpenPanel()
                }
                .keyboardShortcut("o", modifiers: .command)

                Button("New Tab") {
                    model.beginWorkspaceBlockCreation()
                }
                .keyboardShortcut("n", modifiers: .command)

                Button("Close Block") {
                    model.closeSelectedBlock()
                }
                .keyboardShortcut("w", modifiers: .command)
            }

            CommandMenu("View") {
                Button("Toggle Sidebar") {
                    model.toggleSidebar()
                }
                .keyboardShortcut("b", modifiers: .command)
            }

            CommandMenu("Workspaces") {
                Button("Next Workspace") {
                    model.selectWorkspace(offset: 1)
                }
                .keyboardShortcut("]", modifiers: [.command, .option])

                Button("Previous Workspace") {
                    model.selectWorkspace(offset: -1)
                }
                .keyboardShortcut("[", modifiers: [.command, .option])

                Divider()

                ForEach(0..<9, id: \.self) { index in
                    Button("Select Workspace \(index + 1)") {
                        model.selectWorkspace(at: index)
                    }
                    .keyboardShortcut(
                        KeyEquivalent(Character("\(index + 1)")),
                        modifiers: [.command, .option]
                    )
                }
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

                Button("Switch to Recent Block") {
                    model.selectRecentBlock()
                }
                .keyboardShortcut(.tab, modifiers: .control)

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

@MainActor
private final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var model: AppModel?
    private var isTerminating = false

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !isTerminating else { return .terminateNow }
        isTerminating = true
        model?.shutdown()
        return .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        model?.shutdown()
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
        window.isMovableByWindowBackground = false
    }
}
