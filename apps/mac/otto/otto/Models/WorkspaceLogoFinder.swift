import Foundation

enum WorkspaceLogoFinder {
    private static let supportedExtensions = [
        "png", "jpg", "jpeg", "icns", "tiff", "tif", "bmp", "gif", "webp"
    ]

    private static let preferredBasenames = [
        "logo", "app-logo", "app_logo", "brand", "brand-logo", "brand_logo",
        "icon", "app-icon", "app_icon", "appicon", "favicon", "apple-touch-icon"
    ]

    private static let preferredDirectories = [
        "", "public", "static", "assets", "images", "img",
        "public/assets", "public/images", "public/img",
        "src/assets", "src/images", "src/img",
        "app/assets", "resources", "res", ".github"
    ]

    private static let skippedDirectories: Set<String> = [
        ".git", ".next", ".nuxt", ".expo", ".turbo", ".vercel",
        "node_modules", "dist", "build", "out", "coverage", "DerivedData"
    ]

    static func findLogoPath(in workspacePath: String) -> String? {
        let rootURL = URL(fileURLWithPath: workspacePath, isDirectory: true)
        let fileManager = FileManager.default

        for directory in preferredDirectories {
            let directoryURL = directory.isEmpty ? rootURL : rootURL.appendingPathComponent(directory, isDirectory: true)
            guard isDirectory(directoryURL, fileManager: fileManager) else { continue }
            for basename in preferredBasenames {
                for ext in supportedExtensions {
                    let candidateURL = directoryURL.appendingPathComponent(basename).appendingPathExtension(ext)
                    if fileManager.fileExists(atPath: candidateURL.path) {
                        return candidateURL.path
                    }
                }
            }
        }

        return bestShallowMatch(in: rootURL, fileManager: fileManager)
    }

    private static func bestShallowMatch(in rootURL: URL, fileManager: FileManager) -> String? {
        guard let enumerator = fileManager.enumerator(
            at: rootURL,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return nil }

        var best: (url: URL, score: Int)?
        var visitedFileCount = 0
        let rootDepth = rootURL.standardizedFileURL.pathComponents.count

        for case let url as URL in enumerator {
            let name = url.lastPathComponent
            let depth = url.standardizedFileURL.pathComponents.count - rootDepth

            if depth > 4 {
                enumerator.skipDescendants()
                continue
            }

            if isDirectory(url, fileManager: fileManager) {
                if skippedDirectories.contains(name) {
                    enumerator.skipDescendants()
                }
                continue
            }

            guard supportedExtensions.contains(url.pathExtension.lowercased()) else { continue }
            visitedFileCount += 1
            if visitedFileCount > 1_500 { break }

            let basename = url.deletingPathExtension().lastPathComponent.lowercased()
            let score = logoScore(for: basename, depth: depth)
            guard score > 0 else { continue }

            if best == nil || score > best!.score {
                best = (url, score)
            }
        }

        return best?.url.path
    }

    private static func logoScore(for basename: String, depth: Int) -> Int {
        if let exactIndex = preferredBasenames.firstIndex(of: basename) {
            return 1_000 - exactIndex * 10 - depth
        }
        if basename.contains("logo") {
            return 700 - depth
        }
        if basename.contains("appicon") || basename.contains("app-icon") || basename.contains("app_icon") {
            return 650 - depth
        }
        if basename == "favicon" || basename.contains("favicon") {
            return 500 - depth
        }
        if basename == "icon" || basename.hasSuffix("-icon") || basename.hasSuffix("_icon") {
            return 400 - depth
        }
        return 0
    }

    private static func isDirectory(_ url: URL, fileManager: FileManager) -> Bool {
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) else { return false }
        return isDirectory.boolValue
    }
}
