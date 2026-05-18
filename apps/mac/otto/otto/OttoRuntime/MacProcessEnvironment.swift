import Darwin
import Foundation

enum MacProcessEnvironment {
    static func defaultShellPath(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
        if let shell = environment["SHELL"], !shell.isEmpty {
            return shell
        }
        if let passwd = getpwuid(getuid()), let shell = passwd.pointee.pw_shell {
            let value = String(cString: shell)
            if !value.isEmpty {
                return value
            }
        }
        return "/bin/zsh"
    }

    static func augmentedPath(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
        let home = environment["HOME"] ?? FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "\(home)/.config/otto/bin",
            "\(home)/.local/bin",
            "\(home)/.bun/bin",
            "\(home)/.cargo/bin",
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            environment["PATH"] ?? ""
        ]

        var seen = Set<String>()
        var paths: [String] = []
        for candidate in candidates.flatMap({ $0.split(separator: ":").map(String.init) }) {
            guard !candidate.isEmpty, !seen.contains(candidate) else { continue }
            seen.insert(candidate)
            paths.append(candidate)
        }
        return paths.joined(separator: ":")
    }

    static func environment(
        from environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> [String: String] {
        var resolved = environment
        resolved["PATH"] = augmentedPath(environment: environment)
        resolved["SHELL"] = defaultShellPath(environment: environment)
        let term = resolved["TERM"] ?? ""
        resolved["TERM"] = term.isEmpty || term == "dumb" ? "xterm-256color" : term
        return resolved
    }

    static func applyToCurrentProcess() {
        let resolved = environment()
        setenv("PATH", resolved["PATH"] ?? "", 1)
        setenv("SHELL", resolved["SHELL"] ?? "/bin/zsh", 1)
        setenv("TERM", resolved["TERM"] ?? "xterm-256color", 1)
    }
}
