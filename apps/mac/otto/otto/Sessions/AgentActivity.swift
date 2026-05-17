import Foundation

enum AgentActivity: Hashable {
    case fileRead(path: String, line: Int?)
    case fileEdited(path: String, line: Int?)
    case commandStarted(command: String)
    case commandFinished(command: String, exitCode: Int)
}
