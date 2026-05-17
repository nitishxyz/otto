import SwiftUI

struct BlockKindIcon: View {
    let kind: BlockKind
    let size: CGFloat

    init(kind: BlockKind, size: CGFloat = 18) {
        self.kind = kind
        self.size = size
    }

    var body: some View {
        Group {
            if let assetName = kind.brandIconAssetName {
                Image(assetName)
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
            } else {
                Image(systemName: kind.symbolName)
                    .font(.system(size: size, weight: .medium))
            }
        }
        .frame(width: size, height: size)
    }
}

private extension BlockKind {
    var brandIconAssetName: String? {
        switch self {
        case .terminal:
            "GhosttyIcon"
        case .otto, .ottoTUI:
            "OttoIcon"
        case .claudeCode:
            "ClaudeIcon"
        case .codex:
            "OpenAIIcon"
        case .openCode:
            "OpenCodeIcon"
        case .neovim:
            "NeovimIcon"
        default:
            nil
        }
    }
}
