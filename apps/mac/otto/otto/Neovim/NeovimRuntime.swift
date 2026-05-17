import Foundation

struct NeovimRuntime {
    var socketPath: String
    var workingDirectory: String

    func openFileCommand(path: String, line: Int? = nil, column: Int? = nil) -> [String] {
        var target = path
        if let line {
            target += ":\(line)"
            if let column {
                target += ":\(column)"
            }
        }

        return ["nvim", "--server", socketPath, "--remote", target]
    }
}
