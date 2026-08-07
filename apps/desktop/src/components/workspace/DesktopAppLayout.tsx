import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useEdgeHover, usePreferences } from '@ottocode/web-sdk/hooks';
import {
	BrowserPanelToggle,
	BtwFloatingChat,
	ConfirmationDialog,
	AgentsManagerModal,
	AgentsSidebar,
	AgentsSidebarToggle,
	FileBrowserSidebar,
	FileBrowserSidebarToggle,
	GitCommitModal,
	GitSidebar,
	GitSidebarToggle,
	MCPSidebar,
	MCPSidebarToggle,
	ProjectConnectionBanner,
	QuickFilePicker,
	ResizeHandle,
	SessionFilesSidebar,
	SessionFilesSidebarToggle,
	SettingsSidebar,
	SettingsSidebarToggle,
	SkillsSidebar,
	SkillsSidebarToggle,
	SubagentFloatingViewer,
	TerminalPanelToggle,
	TunnelSidebar,
	TunnelSidebarToggle,
	UsageDashboard,
	ViewerTabs,
} from '@ottocode/web-sdk/components';
import {
	useFileBrowserStore,
	useFocusStore,
	useGitStore,
	useMCPStore,
	usePanelWidthStore,
	useRightRailStore,
	useSessionFilesStore,
	useSettingsStore,
	useSidebarStore,
	useSkillsStore,
	useTunnelStore,
	useViewerTabsStore,
} from '@ottocode/web-sdk/stores';
import { DesktopSidebar } from './DesktopSidebar';
import { NativeTerminalViewer } from '../terminal/NativeTerminalViewer';

const CHAT_MIN_WIDTH = 400;
const VIEWER_PANEL_KEY = 'viewer';
const VIEWER_MIN_WIDTH = 320;
const VIEWER_MAX_WIDTH = 4096;
const RIGHT_PANEL_DEFAULT_WIDTH = 320;
const RIGHT_RAIL_HOVER_RATIO = 0.05;
const VIEWER_SIDE_BY_SIDE_QUERY = '(min-width: 1024px)';
const COMPACT_LAYOUT_QUERY = '(max-width: 767px)';
const SMART_EDGE_IGNORE_SELECTOR = '[data-smart-edge-ignore]';

function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() => {
		if (typeof window === 'undefined' || !window.matchMedia) return false;
		return window.matchMedia(query).matches;
	});
	useEffect(() => {
		if (typeof window === 'undefined' || !window.matchMedia) return;
		const mql = window.matchMedia(query);
		const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
		setMatches(mql.matches);
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	}, [query]);
	return matches;
}

function collapseRightPanels() {
	useGitStore.getState().collapseSidebar();
	useSessionFilesStore.getState().collapseSidebar();
	useSettingsStore.getState().collapseSidebar();
	useTunnelStore.getState().collapseSidebar();
	useFileBrowserStore.getState().collapseSidebar();
	useMCPStore.getState().collapseSidebar();
	useSkillsStore.getState().collapseSidebar();
}

interface DesktopAppLayoutProps {
	sidebar: ReactNode;
	children: ReactNode;
	onNewSession?: () => void;
	sessionId?: string;
	onNavigateToSession?: (sessionId: string) => void;
	onFixWithAI?: (errorMessage: string) => void;
	dashboardOpen: boolean;
	onOpenDashboard: () => void;
	onCloseDashboard: () => void;
	titleBar?: ReactNode;
}

export const DesktopAppLayout = memo(function DesktopAppLayout({
	sidebar,
	children,
	onNewSession,
	sessionId,
	onFixWithAI,
	dashboardOpen,
	onOpenDashboard,
	onCloseDashboard,
	titleBar,
}: DesktopAppLayoutProps) {
	const gitExpanded = useGitStore((s) => s.isExpanded);
	const sessionFilesExpanded = useSessionFilesStore((s) => s.isExpanded);
	const settingsExpanded = useSettingsStore((s) => s.isExpanded);
	const tunnelExpanded = useTunnelStore((s) => s.isExpanded);
	const fileBrowserExpanded = useFileBrowserStore((s) => s.isExpanded);
	const mcpExpanded = useMCPStore((s) => s.isExpanded);
	const skillsExpanded = useSkillsStore((s) => s.isExpanded);
	const sessionsCollapsed = useSidebarStore((s) => s.isCollapsed);
	const isRightRailPinned = useRightRailStore((s) => s.isPinned);
	const viewerTabCount = useViewerTabsStore((s) => s.tabs.length);
	const viewerCollapsed = useViewerTabsStore((s) => s.isCollapsed);
	const viewerFocused = useFocusStore((s) => s.currentFocus === 'viewer');
	const panelWidths = usePanelWidthStore((s) => s.widths);
	const { preferences } = usePreferences();
	const anyRightPanelOpen =
		gitExpanded ||
		sessionFilesExpanded ||
		settingsExpanded ||
		tunnelExpanded ||
		fileBrowserExpanded ||
		mcpExpanded ||
		skillsExpanded;
	const anyViewerOpen = viewerTabCount > 0 && !viewerCollapsed;
	const viewerSideBySide = useMediaQuery(VIEWER_SIDE_BY_SIDE_QUERY);
	const compactLayout = useMediaQuery(COMPACT_LAYOUT_QUERY);
	// Compact windows render the sessions sidebar as a full-screen overlay, so
	// the store has to know before paint: it starts closed there and restores
	// the docked preference when the window grows again.
	useLayoutEffect(() => {
		useSidebarStore.getState().setCompactViewport(compactLayout);
	}, [compactLayout]);
	const showChatBesideViewer = !anyViewerOpen || viewerSideBySide;
	const activeRightPanelWidth = gitExpanded
		? (panelWidths.git ?? RIGHT_PANEL_DEFAULT_WIDTH)
		: sessionFilesExpanded
			? (panelWidths['session-files'] ?? RIGHT_PANEL_DEFAULT_WIDTH)
			: settingsExpanded
				? (panelWidths.settings ?? RIGHT_PANEL_DEFAULT_WIDTH)
				: fileBrowserExpanded
					? (panelWidths['file-browser'] ?? RIGHT_PANEL_DEFAULT_WIDTH)
					: RIGHT_PANEL_DEFAULT_WIDTH;
	const viewerPanelWidth = panelWidths[VIEWER_PANEL_KEY];
	const anySidePanelOpen = !sessionsCollapsed || anyRightPanelOpen;
	const viewerPreferredWidth = viewerPanelWidth
		? `${viewerPanelWidth}px`
		: '50%';
	const viewerSideBySideWidth = `min(max(${VIEWER_MIN_WIDTH}px, ${viewerPreferredWidth}), max(0px, calc(100% - ${CHAT_MIN_WIDTH}px)))`;
	const {
		isVisible: isRightRailVisible,
		isHoverPending: isRightRailHoverPending,
	} = useEdgeHover({
		side: 'right',
		enabled: !anyViewerOpen && preferences.smartEdges,
		hoverRatio: RIGHT_RAIL_HOVER_RATIO,
		activeWidth: activeRightPanelWidth,
		ignoreSelector: SMART_EDGE_IGNORE_SELECTOR,
	});
	const previousViewerOpenRef = useRef(anyViewerOpen);
	const previousRightPanelOpenRef = useRef(anyRightPanelOpen);
	const [isRightPanelMounted, setIsRightPanelMounted] =
		useState(anyRightPanelOpen);
	const [rightPanelWidth, setRightPanelWidth] = useState(
		anyRightPanelOpen ? activeRightPanelWidth : 0,
	);
	const [isRightPanelTransitioning, setIsRightPanelTransitioning] =
		useState(false);
	const previousSidePanelOpenRef = useRef(anySidePanelOpen);
	const shouldAnimateViewer =
		previousViewerOpenRef.current !== anyViewerOpen ||
		previousSidePanelOpenRef.current !== anySidePanelOpen;
	const viewerPaneStyle = {
		width: anyViewerOpen
			? viewerSideBySide
				? viewerSideBySideWidth
				: '100%'
			: '0px',
	} as CSSProperties;
	const rightPanelStyle = {
		width: compactLayout
			? anyRightPanelOpen
				? 'min(calc(100vw - 3rem), 380px)'
				: '0px'
			: `${rightPanelWidth}px`,
	} as CSSProperties;
	const shouldRenderRightPanel = anyRightPanelOpen || isRightPanelMounted;
	const shouldShowRightRail =
		anyRightPanelOpen || isRightRailVisible || isRightRailPinned;
	const shouldShowRightEdgeHint =
		(isRightRailHoverPending || isRightRailVisible) && !isRightRailPinned;

	useEffect(() => {
		const wasRightPanelOpen = previousRightPanelOpenRef.current;

		if (anyRightPanelOpen) {
			if (!wasRightPanelOpen) {
				setIsRightPanelTransitioning(true);
				setRightPanelWidth(0);
			}
			setIsRightPanelMounted(true);
			const frame = requestAnimationFrame(() => {
				setRightPanelWidth(activeRightPanelWidth);
			});
			const timeout = window.setTimeout(() => {
				setIsRightPanelTransitioning(false);
			}, 300);
			previousRightPanelOpenRef.current = true;
			return () => {
				cancelAnimationFrame(frame);
				window.clearTimeout(timeout);
			};
		}

		if (!wasRightPanelOpen) {
			setRightPanelWidth(0);
			return;
		}

		setIsRightPanelTransitioning(true);
		setRightPanelWidth(0);
		const timeout = window.setTimeout(() => {
			setIsRightPanelMounted(false);
			setIsRightPanelTransitioning(false);
		}, 300);
		previousRightPanelOpenRef.current = false;
		return () => window.clearTimeout(timeout);
	}, [anyRightPanelOpen, activeRightPanelWidth]);

	useEffect(() => {
		previousViewerOpenRef.current = anyViewerOpen;
	}, [anyViewerOpen]);

	useEffect(() => {
		previousSidePanelOpenRef.current = anySidePanelOpen;
	}, [anySidePanelOpen]);

	return (
		<div className="h-full flex flex-col bg-background touch-manipulation">
			{titleBar}

			<div className="flex-1 flex min-h-0 overflow-hidden">
				<DesktopSidebar onNewSession={onNewSession}>{sidebar}</DesktopSidebar>

				<div className="flex-1 flex flex-col overflow-hidden w-full md:w-auto">
					<div className="flex-1 flex overflow-hidden relative">
						<div
							className={`pointer-events-none absolute inset-y-0 right-0 z-30 hidden w-12 origin-right transition-[opacity,transform] duration-300 ease-out md:block ${
								shouldShowRightEdgeHint
									? 'opacity-50 scale-x-100'
									: 'opacity-0 scale-x-[0.35]'
							}`}
							aria-hidden="true"
						>
							<div className="h-full w-full bg-[radial-gradient(ellipse_at_right,hsl(var(--sidebar-ring)/0.14)_0%,hsl(var(--sidebar-ring)/0.07)_40%,transparent_78%)]" />
						</div>
						<div className="flex min-w-0 flex-1 overflow-hidden">
							<main
								className={`relative flex-col overflow-hidden ${
									!anyViewerOpen
										? 'flex flex-1 min-w-0'
										: showChatBesideViewer
											? 'hidden md:flex md:flex-1 md:min-w-[400px]'
											: 'hidden'
								}`}
							>
								<ProjectConnectionBanner />
								{children}
							</main>
							<section
								data-viewer-pane
								tabIndex={-1}
								className={`relative shrink-0 min-w-0 overflow-hidden border-l bg-sidebar outline-none ${
									anyViewerOpen ? 'flex' : 'hidden md:flex'
								} ${
									anyViewerOpen
										? 'border-sidebar-border opacity-100'
										: 'border-transparent opacity-0'
								} ${
									anyViewerOpen && viewerFocused
										? 'ring-1 ring-inset ring-ring/60'
										: ''
								} ${
									shouldAnimateViewer
										? 'transition-[width,opacity,border-color] duration-300 ease-out'
										: 'transition-none'
								}`}
								style={viewerPaneStyle}
								aria-hidden={!anyViewerOpen}
							>
								{anyViewerOpen && viewerSideBySide && (
									<ResizeHandle
										panelKey={VIEWER_PANEL_KEY}
										side="right"
										minWidth={VIEWER_MIN_WIDTH}
										maxWidth={VIEWER_MAX_WIDTH}
										defaultWidth={VIEWER_MIN_WIDTH}
									/>
								)}
								{anyViewerOpen && (
									<ViewerTabs terminalViewer={NativeTerminalViewer} />
								)}
							</section>
						</div>

						{compactLayout && anyRightPanelOpen && (
							<button
								type="button"
								onClick={collapseRightPanels}
								className="absolute inset-y-0 left-0 right-12 z-50 bg-black/50 backdrop-blur-sm"
								aria-label="Close panel"
							/>
						)}
						<div className="flex">
							<div
								className={`h-full shrink-0 overflow-hidden bg-sidebar ${
									compactLayout
										? 'absolute inset-y-0 right-12 z-[60] border-l border-sidebar-border shadow-2xl transition-[width] duration-300 ease-out'
										: isRightPanelTransitioning
											? 'transition-[width] duration-300 ease-out'
											: 'transition-none'
								}`}
								style={rightPanelStyle}
								aria-hidden={!shouldRenderRightPanel}
							>
								<div className="h-full w-full [&>*]:min-w-full">
									<GitSidebar onFixWithAI={onFixWithAI} sessionId={sessionId} />
									<SessionFilesSidebar sessionId={sessionId} />
									<SettingsSidebar onOpenDashboard={onOpenDashboard} />
									<TunnelSidebar />
									<FileBrowserSidebar />
									<MCPSidebar />
									<SkillsSidebar />
									<AgentsSidebar />
								</div>
							</div>
						</div>

						<div
							className={`relative z-[70] block h-full shrink-0 overflow-hidden transition-[width] duration-150 ease-out ${
								shouldShowRightRail
									? 'w-12 pointer-events-auto'
									: 'w-0 pointer-events-none'
							}`}
						>
							<div
								className={`flex h-full w-12 flex-col border-l shadow-xl transition-[opacity,transform] duration-150 ease-out ${
									shouldShowRightRail
										? 'translate-x-0 opacity-100 pointer-events-auto'
										: 'translate-x-2 opacity-0 pointer-events-none'
								} ${
									anyRightPanelOpen
										? 'sidebar-fade-in border-sidebar-border'
										: 'bg-background border-border'
								}`}
							>
								<GitSidebarToggle />
								<SessionFilesSidebarToggle sessionId={sessionId} />
								<FileBrowserSidebarToggle />
								<BrowserPanelToggle />
								<TunnelSidebarToggle />
								<MCPSidebarToggle />
								<SkillsSidebarToggle />
								<AgentsSidebarToggle />
								<SettingsSidebarToggle />
								<div className="flex-1" />
								<TerminalPanelToggle />
							</div>
						</div>
					</div>
				</div>
			</div>

			<GitCommitModal sessionId={sessionId} />
			<ConfirmationDialog />
			<AgentsManagerModal />
			<QuickFilePicker />
			<BtwFloatingChat />
			<SubagentFloatingViewer />
			{dashboardOpen && <UsageDashboard onBack={onCloseDashboard} />}
		</div>
	);
});
