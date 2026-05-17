import Foundation

struct OttoRuntime {
    var workspaceID: Workspace.ID
    var port: Int
    var baseURL: URL

    static func local(workspaceID: Workspace.ID, port: Int = 19100) -> OttoRuntime {
        OttoRuntime(
            workspaceID: workspaceID,
            port: port,
            baseURL: URL(string: "http://localhost:\(port)")!
        )
    }
}
