import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, TouchEvent } from 'react';
import type { Theme } from '@ottocode/web-sdk/hooks';
import {
	GitSidebarToggle,
	GitSidebar,
	TerminalPanelToggle,
	TerminalsPanel,
	GitCommitModal,
	ConfirmationDialog,
	Button,
	SessionFilesSidebarToggle,
	SessionFilesSidebar,
	SettingsSidebar,
	SettingsSidebarToggle,
	TunnelSidebar,
	TunnelSidebarToggle,
	FileBrowserSidebar,
	FileBrowserSidebarToggle,
	BrowserPanelToggle,
	MCPSidebar,
	MCPSidebarToggle,
	SkillsSidebar,
	SkillsSidebarToggle,
	QuickFilePicker,
	ResizeHandle,
	ViewerTabs,
} from '@ottocode/web-sdk/components';
import {
	useGitStore,
	useSessionFilesStore,
	useSettingsStore,
	useTunnelStore,
	useFileBrowserStore,
	useMCPStore,
	useSkillsStore,
	usePanelWidthStore,
	useViewerTabsStore,
	useSidebarStore,
	useTerminalStore,
} from '@ottocode/web-sdk/stores';
import { Sidebar } from './Sidebar';
import {
	FileCode2,
	FolderOpen,
	GitBranch,
	Menu,
	Moon,
	Network,
	PanelRight,
	Settings,
	Sun,
	Terminal,
	Wrench,
	X,
} from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';

const VIEWER_MIN_CHAT_WIDTH = 360;
const VIEWER_PANEL_KEY = 'viewer';
const VIEWER_DEFAULT_WIDTH = 720;
const VIEWER_MIN_WIDTH = 320;
const VIEWER_MAX_WIDTH = 1200;
const RIGHT_PANEL_DEFAULT_WIDTH = 320;
const VIEWER_SIDE_BY_SIDE_QUERY = '(min-width: 1024px)';
const MOBILE_QUERY = '(max-width: 767px)';

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

interface AppLayoutProps {
	sidebar: ReactNode;
	children: ReactNode;
	onNewSession?: () => void;
	theme: Theme;
	onToggleTheme: () => void;
	sessionId?: string;
	onNavigateToSession?: (sessionId: string) => void;
	onFixWithAI?: (errorMessage: string) => void;
}

export const AppLayout = memo(function AppLayout({
	sidebar,
	children,
	onNewSession,
	theme,
	onToggleTheme,
	sessionId,
	onFixWithAI,
}: AppLayoutProps) {
	const navigate = useNavigate();
	const [isMobilePanelMenuOpen, setIsMobilePanelMenuOpen] = useState(false);
	const touchStartRef = useRef<{ x: number; y: number } | null>(null);
	const gitExpanded = useGitStore((s) => s.isExpanded);
	const toggleGitPanel = useGitStore((s) => s.toggleSidebar);
	const sessionFilesExpanded = useSessionFilesStore((s) => s.isExpanded);
	const toggleSessionFilesPanel = useSessionFilesStore((s) => s.toggleSidebar);
	const settingsExpanded = useSettingsStore((s) => s.isExpanded);
	const toggleSettingsPanel = useSettingsStore((s) => s.toggleSidebar);
	const tunnelExpanded = useTunnelStore((s) => s.isExpanded);
	const toggleTunnelPanel = useTunnelStore((s) => s.toggleSidebar);
	const fileBrowserExpanded = useFileBrowserStore((s) => s.isExpanded);
	const toggleFileBrowserPanel = useFileBrowserStore((s) => s.toggleSidebar);
	const mcpExpanded = useMCPStore((s) => s.isExpanded);
	const toggleMcpPanel = useMCPStore((s) => s.toggleSidebar);
	const skillsExpanded = useSkillsStore((s) => s.isExpanded);
	const toggleSkillsPanel = useSkillsStore((s) => s.toggleSidebar);
	const viewerTabCount = useViewerTabsStore((s) => s.tabs.length);
	const closeAllViewerTabs = useViewerTabsStore((s) => s.closeAllTabs);
	const openSessionsSidebar = useSidebarStore((s) => s.setCollapsed);
	const terminalOpen = useTerminalStore((s) => s.isOpen);
	const toggleTerminalPanel = useTerminalStore((s) => s.togglePanel);
	const panelWidths = usePanelWidthStore((s) => s.widths);
	const anyRightPanelOpen =
		gitExpanded ||
		sessionFilesExpanded ||
		settingsExpanded ||
		tunnelExpanded ||
		fileBrowserExpanded ||
		mcpExpanded ||
		skillsExpanded;
	const anyViewerOpen = viewerTabCount > 0;
	const isMobile = useMediaQuery(MOBILE_QUERY);
	const viewerSideBySide = useMediaQuery(VIEWER_SIDE_BY_SIDE_QUERY);
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
	const viewerPanelWidth =
		panelWidths[VIEWER_PANEL_KEY] ?? VIEWER_DEFAULT_WIDTH;
	const viewerSideBySideWidth = `clamp(${VIEWER_MIN_WIDTH}px, ${viewerPanelWidth}px, calc(100% - ${VIEWER_MIN_CHAT_WIDTH}px))`;
	const previousViewerOpenRef = useRef(anyViewerOpen);
	const previousRightPanelOpenRef = useRef(anyRightPanelOpen);
	const [isRightPanelMounted, setIsRightPanelMounted] =
		useState(anyRightPanelOpen);
	const [rightPanelWidth, setRightPanelWidth] = useState(
		anyRightPanelOpen ? activeRightPanelWidth : 0,
	);
	const [isRightPanelTransitioning, setIsRightPanelTransitioning] =
		useState(false);
	const shouldAnimateViewer = previousViewerOpenRef.current !== anyViewerOpen;
	const mainPaneStyle = {
		width:
			anyViewerOpen && viewerSideBySide
				? `calc(100% - ${viewerSideBySideWidth})`
				: anyViewerOpen
					? '0px'
					: '100%',
	} as CSSProperties;
	const viewerPaneStyle = {
		width: anyViewerOpen
			? viewerSideBySide
				? viewerSideBySideWidth
				: '100%'
			: '0px',
	} as CSSProperties;
	const rightPanelStyle = {
		width: isMobile
			? anyRightPanelOpen
				? 'min(100vw, 380px)'
				: '0px'
			: `${rightPanelWidth}px`,
	} as CSSProperties;
	const shouldRenderRightPanel = anyRightPanelOpen || isRightPanelMounted;
	const closeRightPanels = useCallback(() => {
		useGitStore.getState().collapseSidebar();
		useSessionFilesStore.getState().collapseSidebar();
		useSettingsStore.getState().collapseSidebar();
		useTunnelStore.getState().collapseSidebar();
		useFileBrowserStore.getState().collapseSidebar();
		useMCPStore.getState().collapseSidebar();
		useSkillsStore.getState().collapseSidebar();
	}, []);
	const openMobilePanel = useCallback((togglePanel: () => void) => {
		setIsMobilePanelMenuOpen(false);
		togglePanel();
	}, []);

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

	const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement;
		if (target.closest('button,input,textarea,select,a,[role="button"]')) {
			return;
		}
		const touch = event.touches[0];
		if (!touch) return;
		touchStartRef.current = { x: touch.clientX, y: touch.clientY };
	}, []);

	const handleTouchEnd = useCallback(
		(event: TouchEvent<HTMLDivElement>) => {
			const start = touchStartRef.current;
			touchStartRef.current = null;
			if (!start || !isMobile) return;
			const touch = event.changedTouches[0];
			if (!touch) return;
			const dx = touch.clientX - start.x;
			const dy = touch.clientY - start.y;
			if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.2) return;

			if (start.x < 28 && dx > 0) {
				openSessionsSidebar(false);
				return;
			}

			if (start.x > window.innerWidth - 28 && dx < 0) {
				setIsMobilePanelMenuOpen(true);
				return;
			}

			if (anyRightPanelOpen && dx > 0) {
				closeRightPanels();
			}
		},
		[anyRightPanelOpen, closeRightPanels, isMobile, openSessionsSidebar],
	);

	return (
		<div
			className="h-[var(--app-height,100dvh)] flex bg-background touch-manipulation border-t border-border/50 overflow-hidden"
			onTouchStart={handleTouchStart}
			onTouchEnd={handleTouchEnd}
		>
			{/* Left sidebar - Sessions */}
			<Sidebar onNewSession={onNewSession}>{sidebar}</Sidebar>

			{/* Main content area with bottom terminal panel */}
			<div className="flex-1 flex flex-col overflow-hidden w-full md:w-auto pt-[calc(var(--mobile-safe-area-top)+3rem)] md:pt-0">
				<div className="fixed left-0 right-0 top-0 z-40 flex h-[calc(var(--mobile-safe-area-top)+3rem)] items-end border-b border-border bg-background/85 px-2 pb-1 backdrop-blur-xl md:hidden">
					<div className="flex h-11 w-full items-center gap-1">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => openSessionsSidebar(false)}
							aria-label="Open sessions"
							className="h-10 w-10 rounded-xl"
						>
							<Menu className="h-5 w-5" />
						</Button>
						<div className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-foreground/80">
							{anyViewerOpen ? 'Viewer' : 'Chat'}
						</div>
						{anyViewerOpen && (
							<Button
								variant="ghost"
								size="sm"
								onClick={closeAllViewerTabs}
								className="h-10 rounded-xl px-3 text-xs"
							>
								Chat
							</Button>
						)}
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setIsMobilePanelMenuOpen(true)}
							aria-label="Open tools"
							className="h-10 w-10 rounded-xl"
						>
							<PanelRight className="h-5 w-5" />
						</Button>
						<Button
							variant={terminalOpen ? 'secondary' : 'ghost'}
							size="icon"
							onClick={toggleTerminalPanel}
							aria-label="Toggle terminal"
							className="h-10 w-10 rounded-xl"
						>
							<Terminal className="h-5 w-5" />
						</Button>
					</div>
				</div>
				<div className="flex-1 flex overflow-hidden">
					<div className="flex min-w-0 flex-1 overflow-hidden">
						<main
							className={`relative shrink-0 flex-col overflow-hidden min-w-0 ${
								shouldAnimateViewer
									? 'transition-[width] duration-300 ease-out'
									: 'transition-none'
							} ${
								!anyViewerOpen
									? 'flex'
									: showChatBesideViewer
										? 'hidden md:flex md:min-w-[360px]'
										: 'hidden'
							}`}
							style={mainPaneStyle}
						>
							{children}
						</main>
						<section
							className={`relative shrink-0 min-w-0 overflow-hidden border-l bg-sidebar ${
								anyViewerOpen ? 'flex' : 'hidden md:flex'
							} ${
								anyViewerOpen
									? 'border-sidebar-border opacity-100'
									: 'border-transparent opacity-0'
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
									defaultWidth={VIEWER_DEFAULT_WIDTH}
								/>
							)}
							{anyViewerOpen && <ViewerTabs />}
						</section>
					</div>

					{/* Right sidebar - Git (rail hidden on narrow; panel shows when opened via keybind) */}
					<div className="flex">
						{isMobile && anyRightPanelOpen && (
							<div
								className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm md:hidden"
								onClick={closeRightPanels}
								aria-hidden="true"
							/>
						)}
						<div
							className={`h-full shrink-0 overflow-hidden bg-sidebar ${
								isMobile
									? 'fixed right-0 top-0 bottom-0 z-[60] border-l border-sidebar-border shadow-2xl transition-[width] duration-300 ease-out'
									: isRightPanelTransitioning
										? 'transition-[width] duration-300 ease-out'
										: 'transition-none'
							}`}
							style={rightPanelStyle}
							aria-hidden={!shouldRenderRightPanel}
						>
							{isMobile && anyRightPanelOpen && (
								<Button
									variant="ghost"
									size="icon"
									onClick={closeRightPanels}
									aria-label="Close panel"
									className="absolute right-2 top-[calc(var(--mobile-safe-area-top)+0.5rem)] z-20 h-9 w-9 rounded-xl bg-background/70 backdrop-blur"
								>
									<X className="h-4 w-4" />
								</Button>
							)}
							<div className="h-full w-full">
								<GitSidebar onFixWithAI={onFixWithAI} />
								<SessionFilesSidebar sessionId={sessionId} />
								<SettingsSidebar
									onOpenDashboard={() => navigate({ to: '/dashboard' })}
								/>
								<TunnelSidebar />
								<FileBrowserSidebar />
								<MCPSidebar />
								<SkillsSidebar />
							</div>
						</div>

						<div
							className={`hidden md:flex flex-col w-12 border-l ${anyRightPanelOpen ? 'sidebar-fade-in border-sidebar-border' : 'bg-background border-border'}`}
						>
							<GitSidebarToggle />
							<SessionFilesSidebarToggle sessionId={sessionId} />
							<FileBrowserSidebarToggle />
							<BrowserPanelToggle />
							<TunnelSidebarToggle />
							<MCPSidebarToggle />
							<SkillsSidebarToggle />
							<SettingsSidebarToggle />
							<div className="flex-1" />
							<TerminalPanelToggle />
							<div className="h-12 border-t border-border flex items-center justify-center">
								<Button
									variant="ghost"
									size="icon"
									onClick={onToggleTheme}
									title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
									aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
									className="touch-manipulation"
								>
									{theme === 'dark' ? (
										<Sun className="w-4 h-4" />
									) : (
										<Moon className="w-4 h-4" />
									)}
								</Button>
							</div>
						</div>
					</div>
				</div>

				{/* Bottom terminal panel */}
				<TerminalsPanel />
			</div>

			{isMobilePanelMenuOpen && (
				<div className="fixed inset-0 z-[70] md:hidden">
					<div
						className="absolute inset-0 bg-black/50 backdrop-blur-sm"
						onClick={() => setIsMobilePanelMenuOpen(false)}
						aria-hidden="true"
					/>
					<div className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] rounded-3xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl">
						<div className="mb-2 flex items-center justify-between px-1">
							<div className="text-sm font-medium">Open panel</div>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setIsMobilePanelMenuOpen(false)}
								aria-label="Close panel menu"
								className="h-9 w-9 rounded-xl"
							>
								<X className="h-4 w-4" />
							</Button>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<button
								type="button"
								onClick={() => openMobilePanel(toggleGitPanel)}
								className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 px-3 py-3 text-left text-sm active:bg-accent"
							>
								<GitBranch className="h-4 w-4" /> Git
							</button>
							<button
								type="button"
								onClick={() => openMobilePanel(toggleSessionFilesPanel)}
								className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 px-3 py-3 text-left text-sm active:bg-accent"
							>
								<FileCode2 className="h-4 w-4" /> Session files
							</button>
							<button
								type="button"
								onClick={() => openMobilePanel(toggleFileBrowserPanel)}
								className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 px-3 py-3 text-left text-sm active:bg-accent"
							>
								<FolderOpen className="h-4 w-4" /> Files
							</button>
							<button
								type="button"
								onClick={() => openMobilePanel(toggleTunnelPanel)}
								className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 px-3 py-3 text-left text-sm active:bg-accent"
							>
								<Network className="h-4 w-4" /> Tunnel
							</button>
							<button
								type="button"
								onClick={() => openMobilePanel(toggleMcpPanel)}
								className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 px-3 py-3 text-left text-sm active:bg-accent"
							>
								<Wrench className="h-4 w-4" /> MCP
							</button>
							<button
								type="button"
								onClick={() => openMobilePanel(toggleSkillsPanel)}
								className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 px-3 py-3 text-left text-sm active:bg-accent"
							>
								<Wrench className="h-4 w-4" /> Skills
							</button>
							<button
								type="button"
								onClick={() => openMobilePanel(toggleSettingsPanel)}
								className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 px-3 py-3 text-left text-sm active:bg-accent"
							>
								<Settings className="h-4 w-4" /> Settings
							</button>
							<button
								type="button"
								onClick={onToggleTheme}
								className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 px-3 py-3 text-left text-sm active:bg-accent"
							>
								{theme === 'dark' ? (
									<Sun className="h-4 w-4" />
								) : (
									<Moon className="h-4 w-4" />
								)}
								Theme
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Modals */}
			<GitCommitModal />
			<ConfirmationDialog />
			<QuickFilePicker />
		</div>
	);
});
