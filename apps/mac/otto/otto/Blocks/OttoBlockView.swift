import SwiftUI
import WebKit

struct OttoBlockView: View {
    let block: CanvasBlock
    let workspace: Workspace
    @ObservedObject var runtime: OttoWorkspaceRuntimeSession
    let isFocused: Bool
    let onFocus: () -> Void

    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)

            switch runtime.status {
            case .stopped, .starting:
                OttoRuntimeStateView(
                    title: "Starting Otto for this workspace",
                    message: "Using the workspace server for \(workspace.path).",
                    isLoading: true
                )
            case .failed(let message):
                OttoRuntimeStateView(
                    title: "Otto runtime unavailable",
                    message: message,
                    isLoading: false,
                    actionTitle: "Retry",
                    action: runtime.restart
                )
            case .ready:
                if let webURL = runtime.webURL {
                    OttoRuntimeWebView(url: webURL, isFocused: isFocused, onFocus: onFocus)
                } else {
                    OttoRuntimeStateView(
                        title: "Otto runtime unavailable",
                        message: "The Otto web UI URL was not available.",
                        isLoading: false,
                        actionTitle: "Retry",
                        action: runtime.restart
                    )
                }
            }
        }
        .onTapGesture(perform: onFocus)
    }
}

private struct OttoRuntimeStateView: View {
    let title: String
    let message: String
    var isLoading = false
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            if isLoading {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: "sparkles")
                    .font(.system(size: 24, weight: .light))
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 5) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                Text(message)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
                    .frame(maxWidth: 420)
            }

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .pressableCursor()
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct OttoRuntimeWebView: NSViewRepresentable {
    let url: URL
    let isFocused: Bool
    let onFocus: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(url: url, onFocus: onFocus)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")

        let recognizer = NSClickGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.focusBlock))
        recognizer.delaysPrimaryMouseButtonEvents = false
        webView.addGestureRecognizer(recognizer)

        webView.load(URLRequest(url: url))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.onFocus = onFocus
        if context.coordinator.url != url {
            context.coordinator.url = url
            webView.load(URLRequest(url: url))
        }
        if isFocused, webView.window?.firstResponder == nil {
            webView.window?.makeFirstResponder(webView)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var url: URL
        var onFocus: () -> Void

        init(url: URL, onFocus: @escaping () -> Void) {
            self.url = url
            self.onFocus = onFocus
        }

        @objc func focusBlock() {
            onFocus()
        }
    }
}

#Preview {
    OttoBlockView(
        block: CanvasBlock(kind: .otto),
        workspace: Workspace.previewWorkspaces[0],
        runtime: OttoWorkspaceRuntimeSession(
            workspaceID: Workspace.previewWorkspaces[0].id,
            workspacePath: Workspace.previewWorkspaces[0].path
        ),
        isFocused: true,
        onFocus: {}
    )
    .frame(width: 800, height: 520)
}
