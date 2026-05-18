import AppKit
import Combine
import SwiftUI
import WebKit

private let browserQuickLinks = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://localhost:8080"
]

struct BrowserBlockView: View {
    let block: CanvasBlock
    let isFocused: Bool
    let focusRequestID: Int
    let onFocus: () -> Void

    @ObservedObject private var controller: BrowserSession
    @FocusState private var addressFieldFocused: Bool

    init(
        block: CanvasBlock,
        session: BrowserSession,
        isFocused: Bool = true,
        focusRequestID: Int = 0,
        onFocus: @escaping () -> Void = {}
    ) {
        self.block = block
        self.controller = session
        self.isFocused = isFocused
        self.focusRequestID = focusRequestID
        self.onFocus = onFocus
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar

            ZStack {
                Color.white

                if controller.currentURL.isEmpty && !controller.isLoading {
                    BrowserEmptyState { url in
                        onFocus()
                        controller.navigate(url)
                    }
                } else {
                    BrowserWebView(
                        controller: controller,
                        isFocused: isFocused,
                        focusRequestID: focusRequestID,
                        onFocus: onFocus
                    )
                }

                if let errorMessage = controller.errorMessage {
                    BrowserUnavailableView(
                        title: "Browser block unavailable",
                        message: errorMessage,
                        url: controller.currentURL.isEmpty ? nil : controller.currentURL,
                        onOpenExternal: controller.openCurrentURLExternally
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(red: 0.04, green: 0.04, blue: 0.05))
        .onTapGesture(perform: onFocus)
    }

    private var toolbar: some View {
        HStack(spacing: 8) {
            BrowserToolbarButton(
                systemName: "chevron.left",
                help: "Back",
                isDisabled: !controller.canGoBack,
                action: controller.goBack
            )
            BrowserToolbarButton(
                systemName: "chevron.right",
                help: "Forward",
                isDisabled: !controller.canGoForward,
                action: controller.goForward
            )
            BrowserToolbarButton(
                systemName: "arrow.clockwise",
                help: "Reload",
                isDisabled: controller.currentURL.isEmpty || controller.isLoading,
                action: controller.reload
            )

            ZStack(alignment: .bottomLeading) {
                TextField("Enter a URL or localhost port", text: $controller.draftURL)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .focused($addressFieldFocused)
                    .onSubmit {
                        onFocus()
                        controller.navigate(controller.draftURL)
                        addressFieldFocused = false
                    }

                if controller.isLoading {
                    GeometryReader { proxy in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Color.accentColor)
                            .frame(width: max(80, proxy.size.width * 0.34), height: 2)
                            .offset(x: proxy.size.width * 0.08, y: proxy.size.height - 2)
                    }
                    .allowsHitTesting(false)
                }
            }
            .frame(height: 28)
            .background(Color.white.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(addressFieldFocused ? Color.accentColor.opacity(0.75) : Color.white.opacity(0.08), lineWidth: 1)
            )

            BrowserToolbarButton(
                systemName: "arrow.up.forward.square",
                help: "Open externally",
                isDisabled: controller.currentURL.isEmpty,
                action: controller.openCurrentURLExternally
            )
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(Color(red: 0.04, green: 0.04, blue: 0.05))
        .foregroundStyle(Color.white.opacity(0.78))
        .overlay(alignment: .bottom) {
            Divider()
                .overlay(Color.white.opacity(0.08))
        }
    }
}

private struct BrowserToolbarButton: View {
    let systemName: String
    let help: String
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.white.opacity(isDisabled ? 0.32 : 0.70))
        .background(Color.white.opacity(0.001))
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .disabled(isDisabled)
        .help(help)
        .pressableCursor()
    }
}

private struct BrowserEmptyState: View {
    let onNavigate: (String) -> Void

    var body: some View {
        VStack(spacing: 16) {
            VStack(spacing: 8) {
                Image(systemName: "globe")
                    .font(.system(size: 28, weight: .light))
                    .foregroundStyle(Color.black.opacity(0.42))
                Text("Open a preview, docs page, or dashboard")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.black.opacity(0.78))
                Text("Browser blocks render in a native macOS WKWebView alongside terminal and canvas blocks.")
                    .font(.system(size: 11))
                    .foregroundStyle(Color.black.opacity(0.52))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 360)
            }

            HStack(spacing: 8) {
                ForEach(browserQuickLinks, id: \.self) { url in
                    Button(url.replacingOccurrences(of: "http://", with: "")) {
                        onNavigate(url)
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.black.opacity(0.58))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Color.black.opacity(0.04))
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(Color.black.opacity(0.08), lineWidth: 1)
                    )
                    .pressableCursor()
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct BrowserUnavailableView: View {
    let title: String
    let message: String
    let url: String?
    let onOpenExternal: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "globe.badge.chevron.backward")
                .font(.system(size: 24, weight: .light))
                .foregroundStyle(Color.black.opacity(0.52))
            VStack(spacing: 5) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.black.opacity(0.82))
                Text(message)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.black.opacity(0.58))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 360)
            }
            if url != nil {
                Button("Open externally", action: onOpenExternal)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .pressableCursor()
            }
        }
        .padding(22)
        .background(Color.white.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 18, y: 8)
        .padding(24)
    }
}

private struct BrowserWebView: NSViewRepresentable {
    @ObservedObject var controller: BrowserSession
    let isFocused: Bool
    let focusRequestID: Int
    let onFocus: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onFocus: onFocus)
    }

    func makeNSView(context: Context) -> WKWebView {
        let webView = controller.webView
        let recognizer = NSClickGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.focusBlock))
        recognizer.delaysPrimaryMouseButtonEvents = false
        webView.addGestureRecognizer(recognizer)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.onFocus = onFocus
        context.coordinator.handleFocusRequest(focusRequestID, webView: webView, isFocused: isFocused)
        if isFocused, let window = webView.window, window.firstResponder == nil {
            window.makeFirstResponder(webView)
        }
    }

    final class Coordinator: NSObject {
        var onFocus: () -> Void
        private var lastHandledFocusRequestID = 0

        init(onFocus: @escaping () -> Void) {
            self.onFocus = onFocus
        }

        @objc func focusBlock() {
            onFocus()
        }

        func handleFocusRequest(_ requestID: Int, webView: WKWebView, isFocused: Bool) {
            guard requestID != lastHandledFocusRequestID else { return }
            lastHandledFocusRequestID = requestID
            guard isFocused, let window = webView.window else { return }
            window.makeFirstResponder(webView)
        }
    }
}

@MainActor
final class BrowserSession: NSObject, ObservableObject, WKNavigationDelegate {
    @Published var draftURL = ""
    @Published var currentURL = ""
    @Published var isLoading = false
    @Published var canGoBack = false
    @Published var canGoForward = false
    @Published var errorMessage: String?

    let webView: WKWebView

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true

        super.init()

        webView.navigationDelegate = self
    }

    func navigate(_ value: String) {
        let normalized = Self.normalizeURL(value)
        guard !normalized.isEmpty else { return }
        guard let url = URL(string: normalized) else {
            errorMessage = "That does not look like a valid URL."
            return
        }

        draftURL = normalized
        currentURL = normalized
        errorMessage = nil
        webView.load(URLRequest(url: url))
        updateNavigationState()
    }

    func goBack() {
        guard webView.canGoBack else { return }
        webView.goBack()
        updateNavigationState()
    }

    func goForward() {
        guard webView.canGoForward else { return }
        webView.goForward()
        updateNavigationState()
    }

    func reload() {
        guard !currentURL.isEmpty else { return }
        webView.reload()
        updateNavigationState()
    }

    func openCurrentURLExternally() {
        let value = currentURL.isEmpty ? draftURL : currentURL
        guard let url = URL(string: Self.normalizeURL(value)) else { return }
        NSWorkspace.shared.open(url)
    }

    func stop() {
        webView.stopLoading()
        webView.navigationDelegate = nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        isLoading = true
        errorMessage = nil
        updateURL(from: webView)
        updateNavigationState()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        updateURL(from: webView)
        updateNavigationState()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
        errorMessage = nil
        updateURL(from: webView)
        updateNavigationState()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        isLoading = false
        errorMessage = error.localizedDescription
        updateURL(from: webView)
        updateNavigationState()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        isLoading = false
        errorMessage = error.localizedDescription
        updateURL(from: webView)
        updateNavigationState()
    }

    private func updateURL(from webView: WKWebView) {
        guard let absoluteString = webView.url?.absoluteString else { return }
        currentURL = absoluteString
        draftURL = absoluteString
    }

    private func updateNavigationState() {
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        isLoading = webView.isLoading
    }

    private static func normalizeURL(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if trimmed.range(of: #"^[a-zA-Z][a-zA-Z\d+.-]*:"#, options: .regularExpression) != nil {
            return trimmed
        }
        if trimmed.hasPrefix("//") {
            return "https:\(trimmed)"
        }
        if trimmed.hasPrefix("localhost") ||
            trimmed.hasPrefix("127.0.0.1") ||
            trimmed.range(of: #"^[\w.-]+:\d+(/.*)?$"#, options: .regularExpression) != nil {
            return "http://\(trimmed)"
        }
        return "https://\(trimmed)"
    }
}

#Preview {
    BrowserBlockView(block: CanvasBlock(kind: .browser), session: BrowserSession())
        .frame(width: 800, height: 520)
}
