import Foundation

struct TerminalRuntime {
    var command: String
    var workingDirectory: String

    static let placeholder = TerminalRuntime(command: "zsh", workingDirectory: "~")
}
