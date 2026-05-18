import AppKit
import SwiftUI

struct WorkspaceRail: View {
    @Bindable var model: AppModel
    var showsShortcutNumbers = false

    @State private var isAddWorkspaceHovered = false

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(Array(model.workspaces.enumerated()), id: \.element.id) { index, workspace in
                        WorkspaceRailButton(
                            workspace: workspace,
                            isActive: workspace.id == model.selectedWorkspaceID,
                            shortcutNumber: index + 1,
                            showsShortcutNumber: showsShortcutNumbers && index < 9,
                            action: { model.selectWorkspace(workspace) },
                            onChooseLogo: { model.chooseWorkspaceLogo(workspace) },
                            onDetectLogo: { model.autoDetectWorkspaceLogo(workspace) },
                            onClearLogo: { model.clearWorkspaceLogo(workspace) },
                            onRemove: { model.removeWorkspace(workspace) }
                        )
                    }
                }
                .padding(.top, 10)
            }

            Spacer(minLength: 8)

            Button {
                model.addWorkspaceFromOpenPanel()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(isAddWorkspaceHovered ? Color.primary.opacity(0.10) : Color.primary.opacity(0.06))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(isAddWorkspaceHovered ? Color.accentColor.opacity(0.35) : Color.clear, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .pressableCursor()
            .onHover { isAddWorkspaceHovered = $0 }
            .help("Add workspace")
            .padding(.bottom, 12)
        }
        .frame(maxHeight: .infinity)
    }
}

private struct WorkspaceRailButton: View {
    let workspace: Workspace
    let isActive: Bool
    let shortcutNumber: Int
    let showsShortcutNumber: Bool
    let action: () -> Void
    let onChooseLogo: () -> Void
    let onDetectLogo: () -> Void
    let onClearLogo: () -> Void
    let onRemove: () -> Void

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(Color.primary)
                .frame(width: 3, height: isActive ? 22 : (isHovered ? 10 : 0))
                .opacity(isActive ? 1 : (isHovered ? 0.5 : 0))
                .animation(.easeOut(duration: 0.15), value: isActive)
                .animation(.easeOut(duration: 0.15), value: isHovered)

            Spacer(minLength: 0)

            Button(action: action) {
                ZStack {
                    workspaceIconBackground
                    workspaceIcon
                    if showsShortcutNumber {
                        shortcutBadge
                            .transition(.scale(scale: 0.8).combined(with: .opacity))
                    }
                }
                .frame(width: 36, height: 36)
                .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isActive)
                .animation(.easeOut(duration: 0.12), value: showsShortcutNumber)
            }
            .buttonStyle(.plain)
            .pressableCursor()
            .onHover { isHovered = $0 }
            .help("\(workspace.name)\n\(workspace.path)")
            .contextMenu {
                Button("Set Logo…", action: onChooseLogo)
                Button("Auto-detect Logo", action: onDetectLogo)
                if workspace.logoPath != nil {
                    Button("Clear Logo", action: onClearLogo)
                }
                Divider()
                Button("Forget Workspace", role: .destructive, action: onRemove)
            }

            Spacer(minLength: 0)

            Color.clear.frame(width: 3)
        }
        .frame(width: 56, height: 40)
    }

    @ViewBuilder
    private var workspaceIconBackground: some View {
        let image = workspace.logoPath.flatMap(NSImage.init(contentsOfFile:))
        if let image {
            let analysis = WorkspaceLogoAnalysis(image: image)
            RoundedRectangle(cornerRadius: isActive ? 11 : 14, style: .continuous)
                .fill(analysis.hasTransparency ? analysis.plateColor : Color.clear)
                .shadow(color: Color.black.opacity(isActive ? 0.28 : 0.12), radius: isActive ? 8 : 3, y: isActive ? 3 : 1)
                .overlay(
                    RoundedRectangle(cornerRadius: isActive ? 11 : 14, style: .continuous)
                        .stroke(Color.white.opacity(analysis.hasTransparency ? analysis.plateBorderOpacity : 0.16), lineWidth: 1)
                )
        } else {
            RoundedRectangle(cornerRadius: isActive ? 11 : 14, style: .continuous)
                .fill(workspace.accent.color)
                .shadow(color: workspace.accent.color.opacity(isActive ? 0.35 : 0), radius: 6, y: 2)
        }
    }

    @ViewBuilder
    private var workspaceIcon: some View {
        let image = workspace.logoPath.flatMap(NSImage.init(contentsOfFile:))
        if let image {
            let analysis = WorkspaceLogoAnalysis(image: image)
            if analysis.hasTransparency {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: 26, height: 26)
                    .shadow(color: Color.black.opacity(analysis.imageShadowOpacity), radius: 1, y: 0.5)
            } else {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    .frame(width: 36, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: isActive ? 11 : 14, style: .continuous))
            }
        } else {
            Text(workspace.initials)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
        }
    }

    private var shortcutBadge: some View {
        Text("\(shortcutNumber)")
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundStyle(Color.primary)
            .frame(width: 15, height: 15)
            .background(
                Circle()
                    .fill(.regularMaterial)
                    .shadow(color: Color.black.opacity(0.24), radius: 2, y: 1)
            )
            .overlay(
                Circle()
                    .stroke(Color.white.opacity(0.45), lineWidth: 0.5)
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .offset(x: 3, y: 3)
    }
}

private struct WorkspaceLogoAnalysis {
    let hasTransparency: Bool
    private let averageBrightness: CGFloat

    init(image: NSImage) {
        let sample = Self.sample(image: image)
        hasTransparency = sample.hasTransparency
        averageBrightness = sample.averageBrightness
    }

    var plateColor: Color {
        averageBrightness < 0.58 ? Color.white.opacity(0.92) : Color.black.opacity(0.62)
    }

    var plateBorderOpacity: Double {
        averageBrightness < 0.58 ? 0.42 : 0.18
    }

    var imageShadowOpacity: Double {
        averageBrightness < 0.58 ? 0.16 : 0.55
    }

    private static func sample(image: NSImage) -> (averageBrightness: CGFloat, hasTransparency: Bool) {
        var proposedRect = CGRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil),
              let dataProvider = cgImage.dataProvider,
              let data = dataProvider.data,
              let bytes = CFDataGetBytePtr(data)
        else { return (0.5, true) }

        let width = cgImage.width
        let height = cgImage.height
        let bytesPerRow = cgImage.bytesPerRow
        let bitsPerPixel = cgImage.bitsPerPixel
        guard width > 0, height > 0, bitsPerPixel >= 24 else { return (0.5, true) }

        let bytesPerPixel = max(1, bitsPerPixel / 8)
        let alphaInfo = cgImage.alphaInfo
        let hasAlpha = alphaInfo != .none && alphaInfo != .noneSkipFirst && alphaInfo != .noneSkipLast
        let bitmapInfo = cgImage.bitmapInfo
        let byteOrder = bitmapInfo.intersection(.byteOrderMask)

        var brightness: CGFloat = 0
        var samples: CGFloat = 0
        var transparentSamples: CGFloat = 0
        var totalSamples: CGFloat = 0
        let sampleCount = 9

        for xStep in 0..<sampleCount {
            for yStep in 0..<sampleCount {
                let x = min(width - 1, max(0, width * xStep / sampleCount))
                let y = min(height - 1, max(0, height * yStep / sampleCount))
                let offset = y * bytesPerRow + x * bytesPerPixel
                guard offset + bytesPerPixel <= CFDataGetLength(data) else { continue }

                let components = components(
                    bytes: bytes,
                    offset: offset,
                    bytesPerPixel: bytesPerPixel,
                    alphaInfo: alphaInfo,
                    byteOrder: byteOrder,
                    hasAlpha: hasAlpha
                )

                totalSamples += 1
                if components.alpha < 0.92 {
                    transparentSamples += 1
                }
                guard components.alpha > 0.12 else { continue }

                brightness += components.red * 0.299 + components.green * 0.587 + components.blue * 0.114
                samples += 1
            }
        }

        let transparentRatio = totalSamples > 0 ? transparentSamples / totalSamples : 0
        return (samples > 0 ? brightness / samples : 0.5, transparentRatio > 0.22)
    }

    private static func components(
        bytes: UnsafePointer<UInt8>,
        offset: Int,
        bytesPerPixel: Int,
        alphaInfo: CGImageAlphaInfo,
        byteOrder: CGBitmapInfo,
        hasAlpha: Bool
    ) -> (red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {
        let values = (0..<min(bytesPerPixel, 4)).map { CGFloat(bytes[offset + $0]) / 255 }
        let alpha: CGFloat
        let red: CGFloat
        let green: CGFloat
        let blue: CGFloat

        if bytesPerPixel >= 4, hasAlpha {
            switch alphaInfo {
            case .first, .premultipliedFirst:
                alpha = values[0]
                if byteOrder == .byteOrder32Little {
                    blue = values[1]
                    green = values[2]
                    red = values[3]
                } else {
                    red = values[1]
                    green = values[2]
                    blue = values[3]
                }
            default:
                alpha = values[3]
                if byteOrder == .byteOrder32Little {
                    red = values[2]
                    green = values[1]
                    blue = values[0]
                } else {
                    red = values[0]
                    green = values[1]
                    blue = values[2]
                }
            }
        } else {
            alpha = 1
            red = values.indices.contains(0) ? values[0] : 0.5
            green = values.indices.contains(1) ? values[1] : red
            blue = values.indices.contains(2) ? values[2] : red
        }

        return (red, green, blue, alpha)
    }
}
