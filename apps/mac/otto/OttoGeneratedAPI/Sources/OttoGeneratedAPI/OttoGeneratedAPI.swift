import Foundation
import OpenAPIURLSession

/// Creates a generated otto API client for the local workspace runtime.
public func makeOttoGeneratedClient(serverURL: URL) -> Client {
    Client(serverURL: serverURL, transport: URLSessionTransport())
}
