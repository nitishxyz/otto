import Foundation
import OttoGeneratedAPI

struct OttoAPIClient {
    let baseURL: URL
    let workspacePath: String

    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()

    private var generatedClient: Client {
        makeOttoGeneratedClient(serverURL: baseURL)
    }

    func listSessions(limit: Int = 100) async throws -> [OttoSession] {
        let output = try await generatedClient.listSessions(
            .init(query: .init(project: workspacePath, limit: limit))
        )
        switch output {
        case .ok(let response):
            return try response.body.json.items.map(OttoSession.init(generated:))
        case .undocumented(let statusCode, _):
            throw OttoAPIError.httpStatus(statusCode, nil)
        }
    }

    func createSession(title: String? = nil) async throws -> OttoSession {
        let body: Operations.CreateSession.Input.Body? = title.map { .json(.init(title: $0)) }
        let output = try await generatedClient.createSession(
            .init(query: .init(project: workspacePath), body: body)
        )
        switch output {
        case .created(let response):
            return try OttoSession(generated: response.body.json)
        case .badRequest(let response):
            throw OttoAPIError.httpStatus(400, try? response.body.json.error)
        case .undocumented(let statusCode, _):
            throw OttoAPIError.httpStatus(statusCode, nil)
        }
    }

    func listMessages(sessionID: String) async throws -> [OttoMessage] {
        try await get(
            path: "/v1/sessions/\(sessionID)/messages",
            queryItems: [URLQueryItem(name: "project", value: workspacePath)]
        )
    }

    @discardableResult
    func sendMessage(_ content: String, sessionID: String) async throws -> OttoSendMessageResponse {
        try await post(
            path: "/v1/sessions/\(sessionID)/messages",
            body: ["content": content]
        )
    }

    /// URL for the session SSE stream (`GET /v1/sessions/{id}/stream`).
    func streamURL(sessionID: String) -> URL? {
        try? makeURL(
            path: "/v1/sessions/\(sessionID)/stream",
            queryItems: [URLQueryItem(name: "project", value: workspacePath)]
        )
    }

    private func get<Response: Decodable>(
        path: String,
        queryItems: [URLQueryItem] = []
    ) async throws -> Response {
        var request = URLRequest(url: try makeURL(path: path, queryItems: queryItems))
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await send(request)
    }

    private func post<Response: Decodable, Body: Encodable>(
        path: String,
        body: Body
    ) async throws -> Response {
        var request = URLRequest(
            url: try makeURL(
                path: path,
                queryItems: [URLQueryItem(name: "project", value: workspacePath)]
            )
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    private func send<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw OttoAPIError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw OttoAPIError.httpStatus(httpResponse.statusCode, String(data: data, encoding: .utf8))
        }
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw OttoAPIError.decoding(error)
        }
    }

    private func makeURL(path: String, queryItems: [URLQueryItem]) throws -> URL {
        let normalizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let url = baseURL.appendingPathComponent(normalizedPath)
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw OttoAPIError.invalidURL
        }
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let resolvedURL = components.url else {
            throw OttoAPIError.invalidURL
        }
        return resolvedURL
    }
}

private extension OttoSession {
    init(generated session: Components.Schemas.Session) {
        self.init(
            id: session.id,
            title: session.title,
            agent: session.agent,
            provider: session.provider,
            model: session.model,
            projectPath: session.projectPath,
            createdAt: Double(session.createdAt),
            lastActiveAt: session.lastActiveAt.map(Double.init),
            totalInputTokens: session.totalInputTokens,
            totalOutputTokens: session.totalOutputTokens,
            totalToolTimeMs: session.totalToolTimeMs,
            currentContextTokens: session.currentContextTokens,
            isRunning: session.isRunning
        )
    }
}

enum OttoAPIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpStatus(Int, String?)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "The otto API URL is invalid."
        case .invalidResponse:
            "The otto API returned an invalid response."
        case .httpStatus(let status, let body):
            if let body, !body.isEmpty {
                "otto API returned HTTP \(status): \(body)"
            } else {
                "otto API returned HTTP \(status)."
            }
        case .decoding(let error):
            "Could not decode otto API response: \(error.localizedDescription)"
        }
    }
}
