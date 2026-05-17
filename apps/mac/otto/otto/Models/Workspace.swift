import Foundation
import SwiftUI

struct Workspace: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String
    var path: String
    var accent: WorkspaceAccent
    var blocks: [CanvasBlock]

    init(
        id: UUID = UUID(),
        name: String,
        path: String,
        accent: WorkspaceAccent = .indigo,
        blocks: [CanvasBlock] = []
    ) {
        self.id = id
        self.name = name
        self.path = path
        self.accent = accent
        self.blocks = blocks
    }

    var initials: String {
        let parts = name.split(whereSeparator: { "-_ ".contains($0) })
        if parts.count >= 2 {
            return (parts[0].prefix(1) + parts[1].prefix(1)).uppercased()
        }
        return String(name.prefix(2)).uppercased()
    }

    var sidebarOrderedBlocks: [CanvasBlock] {
        BlockGroup.allCases.flatMap { group in
            blocks.filter { $0.kind.group == group }
        }
    }
}

enum WorkspaceAccent: String, CaseIterable, Codable, Hashable {
    case indigo, pink, emerald, amber, blue, violet

    var color: Color {
        switch self {
        case .indigo: Color(red: 0.39, green: 0.40, blue: 0.95)
        case .pink: Color(red: 0.93, green: 0.28, blue: 0.60)
        case .emerald: Color(red: 0.06, green: 0.72, blue: 0.51)
        case .amber: Color(red: 0.96, green: 0.62, blue: 0.04)
        case .blue: Color(red: 0.23, green: 0.51, blue: 0.96)
        case .violet: Color(red: 0.55, green: 0.36, blue: 0.96)
        }
    }
}

extension Workspace {
    static let previewWorkspaces: [Workspace] = [
        Workspace(
            name: "otto",
            path: "~/dev/nitishxyz/agi",
            accent: .indigo,
            blocks: [
                CanvasBlock(
                    kind: .canvas,
                    children: [
                        CanvasBlock(kind: .otto),
                        CanvasBlock(kind: .terminal),
                        CanvasBlock(kind: .browser)
                    ]
                ),
                CanvasBlock(kind: .otto),
                CanvasBlock(kind: .neovim),
                CanvasBlock(kind: .terminal),
                CanvasBlock(kind: .browser),
                CanvasBlock(kind: .claudeCode)
            ]
        ),
        Workspace(
            name: "preview app",
            path: "~/dev/example",
            accent: .emerald,
            blocks: [
                CanvasBlock(kind: .otto),
                CanvasBlock(kind: .terminal),
                CanvasBlock(kind: .browser)
            ]
        )
    ]
}
