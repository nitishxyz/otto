import Combine
import SwiftUI

struct OttoNativeBlockView: View {
    let block: CanvasBlock
    let workspace: Workspace
    @ObservedObject var runtime: OttoWorkspaceRuntimeSession
    let isFocused: Bool
    var focusRequestID = 0
    let onFocus: () -> Void

    var body: some View {
        ZStack {
            switch runtime.status {
            case .stopped, .starting:
                OttoNativeRuntimeStateView(
                    title: "Starting otto",
                    message: "Preparing a native session surface for \(workspace.name).",
                    isLoading: true
                )
            case .failed(let message):
                OttoNativeRuntimeStateView(
                    title: "otto runtime unavailable",
                    message: message,
                    isLoading: false,
                    actionTitle: "Retry",
                    action: runtime.restart
                )
            case .ready:
                if let apiURL = runtime.apiURL {
                    OttoNativeSessionSurface(apiURL: apiURL, workspace: workspace)
                        .id("\(workspace.id.uuidString)-\(apiURL.absoluteString)")
                } else {
                    OttoNativeRuntimeStateView(
                        title: "otto API unavailable",
                        message: "The local otto API URL was not available.",
                        isLoading: false,
                        actionTitle: "Retry",
                        action: runtime.restart
                    )
                }
            }
        }
        .onTapGesture(perform: onFocus)
        .onChange(of: focusRequestID) { _, _ in
            if isFocused {
                onFocus()
            }
        }
    }
}

private struct OttoNativeRuntimeStateView: View {
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
                Image(systemName: "sparkles.rectangle.stack")
                    .font(.system(size: 25, weight: .light))
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

@MainActor
private final class OttoNativeBlockViewModel: ObservableObject {
    @Published var sessions: [OttoSession] = []
    @Published var selectedSessionID: OttoSession.ID?
    @Published private(set) var messages: [OttoMessage] = []
    @Published var draftMessage = ""
    @Published var draftAttachments: [OttoChatAttachment] = []
    @Published var isPlanMode: Bool = false
    @Published var sessionSearchQuery = ""
    @Published var isLoadingSessions = false
    @Published var isLoadingMessages = false
    @Published var isCreatingSession = false
    @Published var isSending = false
    @Published var errorMessage: String?

    private let client: OttoAPIClient
    private var didStart = false
    private var sessionsPollingTask: Task<Void, Never>?
    private var streamCancellables: Set<AnyCancellable> = []
    let stream: OttoSessionStream

    init(apiURL: URL, workspacePath: String) {
        let client = OttoAPIClient(baseURL: apiURL, workspacePath: workspacePath)
        self.client = client
        self.stream = OttoSessionStream(client: client)
        // Forward stream updates into the view model's published surface.
        stream.$messages
            .receive(on: RunLoop.main)
            .sink { [weak self] next in self?.messages = next }
            .store(in: &streamCancellables)
        stream.$lastError
            .receive(on: RunLoop.main)
            .sink { [weak self] err in
                if let err { self?.errorMessage = err }
            }
            .store(in: &streamCancellables)
    }

    deinit {
        sessionsPollingTask?.cancel()
    }

    var selectedSession: OttoSession? {
        guard let selectedSessionID else { return nil }
        return sessions.first { $0.id == selectedSessionID }
    }

    var filteredSessions: [OttoSession] {
        let query = sessionSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return sessions }
        return sessions.filter { session in
            session.displayTitle.localizedCaseInsensitiveContains(query) ||
                session.displayModel.localizedCaseInsensitiveContains(query) ||
                session.agent.localizedCaseInsensitiveContains(query)
        }
    }

    var runningSessionCount: Int {
        sessions.filter { $0.isRunning == true }.count
    }

    var groupedSessionSections: [OttoNativeSessionSection] {
        let groups = Dictionary(grouping: filteredSessions) { session in
            OttoNativeSessionSection.label(for: session.activityTimestamp)
        }
        return OttoNativeSessionSection.orderedLabels.compactMap { label in
            guard let sessions = groups[label], !sessions.isEmpty else { return nil }
            return OttoNativeSessionSection(label: label, sessions: sessions)
        }
    }

    var canSend: Bool {
        !draftMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    func start() {
        guard sessionsPollingTask == nil else { return }
        if !didStart {
            didStart = true
            Task { await loadSessions(selectFirstIfNeeded: true) }
        }
        // Sessions list still uses a lightweight poll because session metadata
        // (titles, token counts) is updated by the server outside the SSE stream.
        // Per-session messages flow over SSE via `OttoSessionStream`.
        sessionsPollingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(4))
                await self?.refreshSessionsList()
            }
        }
    }

    func stop() {
        sessionsPollingTask?.cancel()
        sessionsPollingTask = nil
        Task { await stream.disconnect() }
    }

    func loadSessions(selectFirstIfNeeded: Bool = false) async {
        isLoadingSessions = true
        defer { isLoadingSessions = false }
        do {
            let nextSessions = try await client.listSessions()
            sessions = nextSessions
            if selectFirstIfNeeded || selectedSessionID == nil || !nextSessions.contains(where: { $0.id == selectedSessionID }) {
                selectedSessionID = nextSessions.first?.id
            }
            if let sessionId = selectedSessionID {
                await stream.connect(sessionId: sessionId)
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectSession(_ session: OttoSession) {
        guard selectedSessionID != session.id else { return }
        selectedSessionID = session.id
        Task { await stream.connect(sessionId: session.id) }
    }

    func createSession() async {
        guard !isCreatingSession else { return }
        isCreatingSession = true
        defer { isCreatingSession = false }
        do {
            let session = try await client.createSession()
            sessions.insert(session, at: 0)
            selectedSessionID = session.id
            await stream.connect(sessionId: session.id)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadMessages() async {
        isLoadingMessages = true
        defer { isLoadingMessages = false }
        await stream.reload()
        errorMessage = stream.lastError
    }

    func sendDraftMessage() async {
        let trimmed = draftMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }
        do {
            if selectedSessionID == nil {
                try await createSessionForSending()
            }
            guard let selectedSessionID else { return }
            isSending = true
            draftMessage = ""
            _ = try await client.sendMessage(trimmed, sessionID: selectedSessionID)
            // SSE will deliver `message.created` and subsequent deltas; just refresh
            // the sidebar list for token counts.
            await refreshSessionsList()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isSending = false
    }

    private func createSessionForSending() async throws {
        let session = try await client.createSession()
        sessions.insert(session, at: 0)
        selectedSessionID = session.id
        await stream.connect(sessionId: session.id)
    }

    /// Refresh just the sessions list without touching the message stream.
    private func refreshSessionsList() async {
        guard didStart else { return }
        do {
            let nextSessions = try await client.listSessions()
            sessions = nextSessions
            if selectedSessionID == nil, let first = nextSessions.first {
                selectedSessionID = first.id
                await stream.connect(sessionId: first.id)
            } else if let selectedSessionID, !nextSessions.contains(where: { $0.id == selectedSessionID }) {
                self.selectedSessionID = nextSessions.first?.id
                if let next = self.selectedSessionID {
                    await stream.connect(sessionId: next)
                }
            }
        } catch {
            if sessions.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Handle a slash command selected from the composer popup.
    /// Mirrors the `onCommand` branch of the web SDK; for now this dispatches to
    /// the local actions we already have. Server-driven commands (e.g. /share,
    /// /branch, /stage) will be plumbed in once the native UI has those screens.
    func handleCommand(_ command: OttoChatCommand) {
        switch command.id {
        case "new":
            Task { await createSession() }
        case "stop":
            // TODO: wire to a cancel endpoint once the API supports it.
            break
        case "clear":
            draftMessage = ""
            draftAttachments.removeAll()
        default:
            // Send the slash command as a regular message so the server can interpret it.
            draftMessage = command.label
            Task { await sendDraftMessage() }
        }
    }
}

private struct OttoNativeSessionSection: Identifiable {
    static let orderedLabels = ["Today", "Yesterday", "Previous 7 Days", "Older"]

    let label: String
    let sessions: [OttoSession]

    var id: String { label }

    static func label(for timestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: timestamp / 1000)
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        let sevenDaysAgo = calendar.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        if date >= sevenDaysAgo { return "Previous 7 Days" }
        return "Older"
    }
}

private struct OttoNativeSessionSurface: View {
    @StateObject private var viewModel: OttoNativeBlockViewModel
    let workspace: Workspace

    init(apiURL: URL, workspace: Workspace) {
        self.workspace = workspace
        _viewModel = StateObject(
            wrappedValue: OttoNativeBlockViewModel(apiURL: apiURL, workspacePath: workspace.path)
        )
    }

    var body: some View {
        HStack(spacing: 0) {
            OttoNativeSessionSidebar(viewModel: viewModel, workspace: workspace)
                .frame(width: 306)

            Divider()
                .opacity(0.5)

            OttoNativeMessageThread(viewModel: viewModel)
        }
        .background(.clear)
        .task { viewModel.start() }
        .onDisappear { viewModel.stop() }
    }
}

private struct OttoNativeSessionSidebar: View {
    @ObservedObject var viewModel: OttoNativeBlockViewModel
    let workspace: Workspace
    @Namespace private var selectionNamespace

    var body: some View {
        ZStack {
            OttoNativeSidebarBackground()

            sessionContent
                .safeAreaInset(edge: .top, spacing: 0) {
                    glassHeader
                }
        }
        .background(.ultraThinMaterial)
        .animation(.snappy(duration: 0.24, extraBounce: 0.08), value: viewModel.filteredSessions)
        .animation(.snappy(duration: 0.22, extraBounce: 0.05), value: viewModel.selectedSessionID)
    }

    private var glassHeader: some View {
        VStack(spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                ZStack {
                    Circle()
                        .fill(Color.accentColor.opacity(0.16))
                    Image(systemName: "sparkles")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                }
                .frame(width: 30, height: 30)
                .overlay(Circle().stroke(Color.white.opacity(0.10), lineWidth: 0.5))

                VStack(alignment: .leading, spacing: 1) {
                    Text("otto")
                        .font(.system(size: 15, weight: .bold))
                    Text(workspace.name)
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                headerCircleButton(
                    systemName: viewModel.isLoadingSessions ? "arrow.triangle.2.circlepath" : "arrow.clockwise",
                    disabled: viewModel.isLoadingSessions,
                    help: "Refresh sessions"
                ) {
                    Task { await viewModel.loadSessions() }
                }

                headerCircleButton(
                    systemName: viewModel.isCreatingSession ? "hourglass" : "plus",
                    disabled: viewModel.isCreatingSession,
                    help: "New session"
                ) {
                    Task { await viewModel.createSession() }
                }
            }

            OttoNativeSearchField(text: $viewModel.sessionSearchQuery)
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                Rectangle().fill(Color.black.opacity(0.18))
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.white.opacity(0.06))
                .frame(height: 0.5)
        }
    }

    private func headerCircleButton(
        systemName: String,
        disabled: Bool,
        help: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 30, height: 30)
        }
        .buttonStyle(.plain)
        .background(.regularMaterial, in: Circle())
        .overlay(Circle().stroke(Color.white.opacity(0.10), lineWidth: 0.5))
        .contentShape(Circle())
        .disabled(disabled)
        .help(help)
        .pressableCursor()
    }

    @ViewBuilder
    private var sessionContent: some View {
        if viewModel.sessions.isEmpty && viewModel.isLoadingSessions {
            VStack(spacing: 8) {
                ForEach(0..<7, id: \.self) { index in
                    OttoNativeSessionSkeletonRow()
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                        .animation(.easeOut(duration: 0.22).delay(Double(index) * 0.025), value: viewModel.isLoadingSessions)
                }
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else if viewModel.sessions.isEmpty {
            OttoNativeSessionEmptyState(
                title: "No sessions yet",
                message: "Start a native otto conversation and it will land here.",
                actionTitle: "Create session",
                action: { Task { await viewModel.createSession() } }
            )
        } else if viewModel.filteredSessions.isEmpty {
            OttoNativeSessionEmptyState(
                title: "No matches",
                message: "Try a different title, model, or agent.",
                actionTitle: "Clear search",
                action: { viewModel.sessionSearchQuery = "" }
            )
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2, pinnedViews: []) {
                    ForEach(viewModel.groupedSessionSections) { section in
                        Section {
                            VStack(spacing: 2) {
                                ForEach(Array(section.sessions.enumerated()), id: \.element.id) { index, session in
                                    OttoNativeSessionRow(
                                        session: session,
                                        isSelected: session.id == viewModel.selectedSessionID,
                                        namespace: selectionNamespace,
                                        index: index,
                                        action: { viewModel.selectSession(session) }
                                    )
                                    .transition(.asymmetric(
                                        insertion: .move(edge: .top).combined(with: .opacity),
                                        removal: .scale(scale: 0.96).combined(with: .opacity)
                                    ))
                                }
                            }
                        } header: {
                            OttoNativeSectionHeader(label: section.label)
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.top, 2)
                .padding(.bottom, 14)
            }
            .scrollIndicators(.hidden)
        }
    }
}

private struct OttoNativeSidebarBackground: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(.ultraThinMaterial)

            Circle()
                .fill(Color.accentColor.opacity(0.16))
                .frame(width: 190, height: 190)
                .blur(radius: 46)
                .offset(x: -72, y: -54)

            Circle()
                .fill(Color.primary.opacity(0.055))
                .frame(width: 180, height: 180)
                .blur(radius: 56)
                .offset(x: 176, y: 116)

            LinearGradient(
                colors: [Color.primary.opacity(0.045), Color.clear],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .ignoresSafeArea()
    }
}

private struct OttoNativeSearchField: View {
    @Binding var text: String
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(isFocused ? Color.accentColor : .secondary)

            TextField("Search sessions", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 12, weight: .medium))
                .focused($isFocused)

            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.tertiary)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.plain)
                .pressableCursor()
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 36)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(isFocused ? Color.accentColor.opacity(0.44) : Color.primary.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: .black.opacity(isFocused ? 0.08 : 0.04), radius: isFocused ? 14 : 8, y: isFocused ? 7 : 4)
        .animation(.snappy(duration: 0.18, extraBounce: 0.04), value: isFocused)
    }
}

private struct OttoNativeSidebarMetric: View {
    let label: String
    let value: String
    let symbolName: String
    var tint: Color = .accentColor

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbolName)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 22, height: 22)
                .background(tint.opacity(0.12))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 0) {
                Text(value)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                Text(label)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .frame(height: 46)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(Color.primary.opacity(0.06), lineWidth: 1)
        )
    }
}

private struct OttoNativeSessionEmptyState: View {
    let title: String
    let message: String
    let actionTitle: String
    let action: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.12))
                    .frame(width: 62, height: 62)
                Image(systemName: "sparkles")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
            }
            VStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                Text(message)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 190)
            }
            Button(actionTitle, action: action)
                .buttonStyle(.bordered)
                .controlSize(.small)
                .pressableCursor()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .transition(.opacity.combined(with: .scale(scale: 0.98)))
    }
}

private struct OttoNativeSessionSkeletonRow: View {
    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.08))
                .frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 7) {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(Color.primary.opacity(0.10))
                    .frame(width: 150, height: 8)
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(Color.primary.opacity(0.06))
                    .frame(width: 104, height: 7)
            }
            Spacer()
        }
        .padding(10)
        .frame(height: 66)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .redacted(reason: .placeholder)
    }
}

private struct OttoNativeSectionHeader: View {
    let label: String

    var body: some View {
        HStack(spacing: 8) {
            Text(label.uppercased())
                .font(.system(size: 9.5, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(.tertiary)
            Rectangle()
                .fill(Color.primary.opacity(0.06))
                .frame(height: 1)
        }
        .padding(.horizontal, 4)
        .padding(.top, 14)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct OttoNativeSessionRow: View {
    let session: OttoSession
    let isSelected: Bool
    let namespace: Namespace.ID
    let index: Int
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovered = false
    @State private var hasAppeared = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(session.displayTitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .truncationMode(.tail)

                    metadataLine
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                statusDot
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .overlay(rowStroke)
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .offset(y: reduceMotion || hasAppeared ? 0 : 6)
            .opacity(hasAppeared ? 1 : 0)
        }
        .buttonStyle(.plain)
        .pressableCursor()
        .onHover { hovering in
            isHovered = hovering
        }
        .onAppear {
            guard !hasAppeared else { return }
            if reduceMotion {
                hasAppeared = true
            } else {
                withAnimation(.smooth(duration: 0.22).delay(min(Double(index) * 0.02, 0.16))) {
                    hasAppeared = true
                }
            }
        }
        .animation(.snappy(duration: 0.18, extraBounce: 0.04), value: isHovered)
        .animation(.snappy(duration: 0.22, extraBounce: 0.04), value: isSelected)
    }

    private var metadataLine: Text {
        let metaFont = Font.system(size: 11, weight: .medium)
        let secondary = Color.secondary
        let tertiary = Color.primary.opacity(0.40)

        var line = Text(session.displayModel)
            .font(metaFont)
            .foregroundColor(secondary)

        line = line
            + Text("  ·  ")
                .font(metaFont)
                .foregroundColor(tertiary)
            + Text(Self.relativeDateString(from: session.activityTimestamp))
                .font(metaFont)
                .foregroundColor(tertiary)

        if let tokens = session.totalOutputTokens, tokens > 0 {
            line = line
                + Text("  ·  ")
                    .font(metaFont)
                    .foregroundColor(tertiary)
                + Text("\(Self.formatTokens(tokens)) out")
                    .font(metaFont)
                    .foregroundColor(tertiary)
        }

        return line
    }

    @ViewBuilder
    private var statusDot: some View {
        if session.isRunning == true {
            OttoNativeRunningDot()
        } else {
            Circle()
                .fill(Color.primary.opacity(isSelected ? 0.32 : 0.18))
                .frame(width: 6, height: 6)
        }
    }

    @ViewBuilder
    private var rowBackground: some View {
        if isSelected {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.05))
                .matchedGeometryEffect(id: "selected-session-background", in: namespace)
        } else if isHovered {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.025))
        } else {
            Color.clear
        }
    }

    private var rowStroke: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(
                isSelected
                    ? Color.white.opacity(0.10)
                    : Color.white.opacity(isHovered ? 0.05 : 0.0),
                lineWidth: 0.5
            )
    }

    private static func relativeDateString(from timestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: timestamp / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private static func formatTokens(_ value: Int) -> String {
        if value >= 1000 {
            let thousands = Double(value) / 1000
            if thousands >= 100 {
                return String(format: "%.0fk", thousands)
            }
            return String(format: "%.1fk", thousands)
        }
        return "\(value)"
    }
}

private struct OttoNativeRunningDot: View {
    var body: some View {
        Circle()
            .fill(Color.green)
            .frame(width: 7, height: 7)
            .overlay {
                TimelineView(.animation) { timeline in
                    let phase = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.2) / 1.2
                    Circle()
                        .stroke(Color.green.opacity(0.42), lineWidth: 1)
                        .scaleEffect(1 + phase * 1.8)
                        .opacity(1 - phase)
                }
            }
    }
}

private struct OttoNativeMessageThread: View {
    @ObservedObject var viewModel: OttoNativeBlockViewModel

    var body: some View {
        VStack(spacing: 0) {
            threadHeader

            Divider().opacity(0.5)

            ZStack {
                if viewModel.selectedSessionID == nil {
                    emptyThread
                } else if viewModel.messages.isEmpty && viewModel.isLoadingMessages {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    messageScrollView
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if let errorMessage = viewModel.errorMessage {
                OttoNativeErrorBanner(message: errorMessage)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
            }

            OttoChatInputView(
                text: $viewModel.draftMessage,
                attachments: $viewModel.draftAttachments,
                isPlanMode: $viewModel.isPlanMode,
                disabled: viewModel.isSending,
                isSending: viewModel.isSending,
                providerName: viewModel.selectedSession?.provider,
                modelName: viewModel.selectedSession?.model,
                agent: viewModel.selectedSession?.agent,
                onSend: {
                    Task { await viewModel.sendDraftMessage() }
                },
                onCommand: { command in
                    viewModel.handleCommand(command)
                },
                onRemoveAttachment: { attachment in
                    viewModel.draftAttachments.removeAll { $0.id == attachment.id }
                }
            )
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
        }
        .background(.thinMaterial)
    }

    private var threadHeader: some View {
        HStack(spacing: 10) {
            Image(systemName: "bubble.left.and.text.bubble.right")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(viewModel.selectedSession?.displayTitle ?? "Message thread")
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text(viewModel.selectedSession?.displayModel ?? "Select a session to view messages")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if viewModel.selectedSession?.isRunning == true || viewModel.isSending {
                Label("Running", systemImage: "circle.fill")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Color.green)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
        .background(.bar)
    }

    private var messageScrollView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 22) {
                    if viewModel.messages.isEmpty {
                        emptyThread
                            .padding(.top, 40)
                    } else {
                        let grouped = OttoThreadLayout.groupConsecutive(viewModel.messages)
                        ForEach(Array(grouped.enumerated()), id: \.element.id) { _, group in
                            OttoNativeMessageGroup(group: group)
                                .id(group.id)
                                .transition(.asymmetric(
                                    insertion: .opacity.combined(with: .move(edge: .bottom)),
                                    removal: .opacity
                                ))
                        }
                        // Bottom anchor for scrollTo.
                        Color.clear
                            .frame(height: 1)
                            .id(OttoThreadLayout.bottomAnchor)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 16)
                .animation(.smooth(duration: 0.18), value: viewModel.messages.map(\.id))
            }
            .onChange(of: viewModel.messages.last?.id) { _, _ in
                scrollToBottom(proxy: proxy)
            }
            .onChange(of: viewModel.messages.last?.parts?.count ?? 0) { _, _ in
                scrollToBottom(proxy: proxy)
            }
            .onAppear { scrollToBottom(proxy: proxy, animated: false) }
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool = true) {
        let action = { proxy.scrollTo(OttoThreadLayout.bottomAnchor, anchor: .bottom) }
        if animated {
            withAnimation(.smooth(duration: 0.22)) { action() }
        } else {
            action()
        }
    }

    private var emptyThread: some View {
        VStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(Color.accentColor)
            Text("Ask otto anything")
                .font(.system(size: 15, weight: .semibold))
            Text("Native sessions and message history are wired to the local otto runtime. Streaming, approvals, and richer tool renderers come next.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
        }
        .padding(24)
    }
}

// MARK: - Thread layout helpers

/// Groups consecutive messages from the same role so they share a single header.
enum OttoThreadLayout {
    static let bottomAnchor = "otto-thread-bottom"

    struct Group: Identifiable {
        let id: String
        let role: String
        let messages: [OttoMessage]
    }

    static func groupConsecutive(_ messages: [OttoMessage]) -> [Group] {
        var groups: [Group] = []
        for message in messages {
            if let last = groups.last, last.role == message.role {
                groups.removeLast()
                groups.append(Group(id: last.id, role: last.role, messages: last.messages + [message]))
            } else {
                groups.append(Group(id: "g-\(message.id)", role: message.role, messages: [message]))
            }
        }
        return groups
    }
}

// MARK: - Group view
//
// Web-SDK-style thread layout:
// - Assistant: small avatar rail on the left, header line, then parts flow
//   directly underneath (no bubble container). Parts hug the leading edge.
// - User: right-aligned content-sized chip (NOT full width). Header sits above
//   the chip on the right, parts wrap to their natural width up to a max.

private struct OttoNativeMessageGroup: View {
    let group: OttoThreadLayout.Group

    private var isUser: Bool { group.role == "user" }
    private var isStreaming: Bool { group.messages.contains(where: { $0.isPending }) }

    var body: some View {
        if isUser {
            userGroup
        } else {
            assistantGroup
        }
    }

    // MARK: Assistant

    private var assistantGroup: some View {
        // Header row sits inline with the avatar; the parts column flows at the
        // full leading edge underneath (no indent — like a CLI transcript).
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                avatar
                assistantHeader
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 14) {
                ForEach(group.messages) { message in
                    OttoNativeAssistantMessage(message: message)
                        .id(message.id)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    private var avatar: some View {
        ZStack {
            Circle()
                .fill(Color.accentColor.opacity(0.18))
            Image(systemName: "sparkles")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.accentColor)
        }
        .frame(width: 20, height: 20)
        .overlay(
            Circle().stroke(Color.accentColor.opacity(0.28), lineWidth: 0.5)
        )
    }

    private var assistantHeader: some View {
        HStack(spacing: 6) {
            Text("otto")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.primary)
            if let model = group.messages.last?.model, !model.isEmpty {
                OttoRendererDot()
                Text(model)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }
            if isStreaming {
                OttoRendererDot()
                HStack(spacing: 4) {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 5, height: 5)
                        .modifier(OttoStreamingPulse())
                    Text("thinking")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.accentColor.opacity(0.85))
                }
            }
        }
    }

    // MARK: User

    private var userGroup: some View {
        VStack(alignment: .trailing, spacing: 4) {
            HStack(spacing: 6) {
                if let createdAt = group.messages.last?.createdAt {
                    Text(Self.timeFormatter.string(from: Date(timeIntervalSince1970: createdAt / 1000)))
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                    OttoRendererDot()
                }
                Text("You")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
            }
            VStack(alignment: .trailing, spacing: 6) {
                ForEach(group.messages) { message in
                    OttoNativeUserMessage(message: message)
                        .id(message.id)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.vertical, 4)
    }

    static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f
    }()
}

// MARK: - Assistant message (no bubble)

private struct OttoNativeAssistantMessage: View {
    let message: OttoMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(blocks, id: \.id) { block in
                switch block {
                case .compact(_, let entries):
                    OttoCompactActivityStripView(entries: entries, isStreaming: message.isPending)
                case .part(let part):
                    OttoMessagePartView(part: part)
                }
            }

            if let error = message.error, !error.isEmpty {
                OttoErrorPartView(message: error)
            }

            if blocks.isEmpty && message.error == nil && message.isPending {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 5, height: 5)
                        .modifier(OttoStreamingPulse())
                    Text("Thinking…")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.smooth(duration: 0.18), value: blocks.map(\.id))
    }

    private var blocks: [OttoMessageBlock] {
        let parts = (message.parts ?? []).filter { part in
            switch part.type {
            case "text", "reasoning":
                return (part.textContent?.isEmpty == false)
            default:
                return true
            }
        }
        return OttoMessageBlocker.makeBlocks(from: parts)
    }
}

// MARK: - User message (content-sized chip)

private struct OttoNativeUserMessage: View {
    let message: OttoMessage

    var body: some View {
        let parts = message.parts ?? []
        let textParts = parts.filter { $0.type == "text" }
        let imageParts = parts.filter { $0.type == "image" || $0.type == "file" }

        VStack(alignment: .trailing, spacing: 6) {
            if !imageParts.isEmpty {
                HStack(spacing: 6) {
                    ForEach(imageParts) { part in
                        OttoMessagePartView(part: part)
                    }
                }
            }

            if !textParts.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(textParts) { part in
                        Text(part.textContent ?? part.content)
                            .font(.system(size: 13))
                            .textSelection(.enabled)
                            .lineSpacing(3)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: 520, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.accentColor.opacity(0.14))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.accentColor.opacity(0.22), lineWidth: 0.5)
                )
            }

            if let error = message.error, !error.isEmpty {
                OttoErrorPartView(message: error)
                    .frame(maxWidth: 520, alignment: .trailing)
            }
        }
    }
}

private struct OttoNativeErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.orange)
            Text(message)
                .font(.system(size: 11))
                .lineLimit(2)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color.orange.opacity(0.10))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.orange.opacity(0.18), lineWidth: 1)
        )
    }
}

#Preview {
    OttoNativeBlockView(
        block: CanvasBlock(kind: .ottoNative),
        workspace: Workspace.previewWorkspaces[0],
        runtime: OttoWorkspaceRuntimeSession(
            workspaceID: Workspace.previewWorkspaces[0].id,
            workspacePath: Workspace.previewWorkspaces[0].path
        ),
        isFocused: true,
        onFocus: {}
    )
    .frame(width: 980, height: 620)
}
