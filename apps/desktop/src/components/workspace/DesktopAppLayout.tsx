import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { usePreferences, type Theme } from '@ottocode/web-sdk/hooks';
import {
	BrowserPanelToggle,
	Button,
	ConfirmationDialog,
	FileBrowserSidebar,
	FileBrowserSidebarToggle,
	GitCommitModal,
	GitSidebar,
	GitSidebarToggle,
	MCPSidebar,
	MCPSidebarToggle,
	QuickFilePicker,
	ResizeHandle,
	SessionFilesSidebar,
	SessionFilesSidebarToggle,
	SettingsSidebar,
	SettingsSidebarToggle,
	SkillsSidebar,
	SkillsSidebarToggle,
	TerminalPanelToggle,
	TerminalsPanel,
	TunnelSidebar,
	TunnelSidebarToggle,
	UsageDashboard,
	ViewerTabs,
} from '@ottocode/web-sdk/components';
import {
	useFileBrowserStore,
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

const VIEWER_MIN_CHAT_WIDTH = 360;
const VIEWER_PANEL_KEY = 'viewer';
const VIEWER_DEFAULT_WIDTH = 720;
const VIEWER_MIN_WIDTH = 320;
const VIEWER_MAX_WIDTH = 1200;
const RIGHT_PANEL_DEFAULT_WIDTH = 320;
const RIGHT_RAIL_HOVER_RATIO = 0.05;
const HOVER_SHOW_DELAY_MS = 260;
const HOVER_HIDE_DELAY_MS = 120;
const VIEWER_SIDE_BY_SIDE_QUERY = '(min-width: 1024px)';

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

interface DesktopAppLayoutProps {
	sidebar: ReactNode;
	children: ReactNode;
	onNewSession?: () => void;
	theme: Theme;
	onToggleTheme: () => void;
	sessionId?: string;
	onNavigateToSession?: (sessionId: string) => void;
	onFixWithAI?: (errorMessage: string) => void;
	dashboardOpen: boolean;
	onOpenDashboard: () => void;
	onCloseDashboard: () => void;
}

export const DesktopAppLayout = memo(function DesktopAppLayout({
	sidebar,
	children,
	onNewSession,
	theme,
	onToggleTheme,
	sessionId,
	onFixWithAI,
	dashboardOpen,
	onOpenDashboard,
	onCloseDashboard,
}: DesktopAppLayoutProps) {
	const gitExpanded = useGitStore((s) => s.isExpanded);
	const sessionFilesExpanded = useSessionFilesStore((s) => s.isExpanded);
	const settingsExpanded = useSettingsStore((s) => s.isExpanded);
	const tunnelExpanded = useTunnelStore((s) => s.isExpanded);
	const fileBrowserExpanded = useFileBrowserStore((s) => s.isExpanded);
	const mcpExpanded = useMCPStore((s) => s.isExpanded);
	const skillsExpanded = useSkillsStore((s) => s.isExpanded);
	const setSessionsCollapsed = useSidebarStore((s) => s.setCollapsed);
	const isRightRailPinned = useRightRailStore((s) => s.isPinned);
	const viewerTabCount = useViewerTabsStore((s) => s.tabs.length);
	const panelWidths = usePanelWidthStore((s) => s.widths);
	const { preferences } = usePreferences();
	const smartEdges = preferences.smartEdges;
	const anyRightPanelOpen =
		gitExpanded ||
		sessionFilesExpanded ||
		settingsExpanded ||
		tunnelExpanded ||
		fileBrowserExpanded ||
		mcpExpanded ||
		skillsExpanded;
	const anyViewerOpen = viewerTabCount > 0;
	const anyRightSurfaceOpen = anyRightPanelOpen || anyViewerOpen;
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
	const isRightRailVisibleRef = useRef(false);
	const rightRailShowTimeoutRef = useRef<number | null>(null);
	const rightRailHideTimeoutRef = useRef<number | null>(null);
	const [isRightPanelMounted, setIsRightPanelMounted] =
		useState(anyRightPanelOpen);
	const [rightPanelWidth, setRightPanelWidth] = useState(
		anyRightPanelOpen ? activeRightPanelWidth : 0,
	);
	const [isRightPanelTransitioning, setIsRightPanelTransitioning] =
		useState(false);
	const [isRightRailVisible, setIsRightRailVisible] = useState(false);
	const [isRightRailHoverPending, setIsRightRailHoverPending] = useState(false);
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
		width: `${rightPanelWidth}px`,
	} as CSSProperties;
	const shouldRenderRightPanel = anyRightPanelOpen || isRightPanelMounted;
	const shouldShowRightRail =
		anyRightPanelOpen || isRightRailVisible || isRightRailPinned;
	const shouldShowRightEdgeHint =
		(isRightRailHoverPending || isRightRailVisible) && !isRightRailPinned;

	// Auto-collapse sessions list when any right-side surface is open,
	// and restore the user's previous state when everything closes.
	const prevRightSurfaceOpenRef = useRef(false);
	const wasSessionsCollapsedRef = useRef<boolean | null>(null);
	useEffect(() => {
		if (anyRightSurfaceOpen && !prevRightSurfaceOpenRef.current) {
			wasSessionsCollapsedRef.current = useSidebarStore.getState().isCollapsed;
			setSessionsCollapsed(true);
		} else if (!anyRightSurfaceOpen && prevRightSurfaceOpenRef.current) {
			if (wasSessionsCollapsedRef.current !== null) {
				setSessionsCollapsed(wasSessionsCollapsedRef.current);
				wasSessionsCollapsedRef.current = null;
			}
		}
		prevRightSurfaceOpenRef.current = anyRightSurfaceOpen;
	}, [anyRightSurfaceOpen, setSessionsCollapsed]);

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
		const setRailVisible = (visible: boolean) => {
			isRightRailVisibleRef.current = visible;
			setIsRightRailVisible(visible);
		};

		const clearHoverTimeouts = () => {
			if (rightRailShowTimeoutRef.current !== null) {
				window.clearTimeout(rightRailShowTimeoutRef.current);
				rightRailShowTimeoutRef.current = null;
			}
			if (rightRailHideTimeoutRef.current !== null) {
				window.clearTimeout(rightRailHideTimeoutRef.current);
				rightRailHideTimeoutRef.current = null;
			}
		};

		const scheduleRailVisible = (visible: boolean) => {
			if (isRightRailVisibleRef.current === visible) {
				setIsRightRailHoverPending(false);
				return;
			}

			setIsRightRailHoverPending(visible);
			const delay = visible ? HOVER_SHOW_DELAY_MS : HOVER_HIDE_DELAY_MS;
			const targetRef = visible
				? rightRailShowTimeoutRef
				: rightRailHideTimeoutRef;
			const oppositeRef = visible
				? rightRailHideTimeoutRef
				: rightRailShowTimeoutRef;

			if (oppositeRef.current !== null) {
				window.clearTimeout(oppositeRef.current);
				oppositeRef.current = null;
			}

			if (targetRef.current !== null) return;

			targetRef.current = window.setTimeout(() => {
				setRailVisible(visible);
				setIsRightRailHoverPending(false);
				targetRef.current = null;
			}, delay);
		};

		const handleMouseMove = (event: MouseEvent) => {
			const hoverWidth = window.innerWidth * RIGHT_RAIL_HOVER_RATIO;
			scheduleRailVisible(window.innerWidth - event.clientX <= hoverWidth);
		};
		const handleMouseLeave = () => {
			clearHoverTimeouts();
			setIsRightRailHoverPending(false);
			setRailVisible(false);
		};
		const handleMouseOut = (event: MouseEvent) => {
			if (!event.relatedTarget) {
				handleMouseLeave();
			}
		};

		if (!smartEdges) {
			clearHoverTimeouts();
			setIsRightRailHoverPending(false);
			setRailVisible(false);
			return;
		}

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseout', handleMouseOut);
		window.addEventListener('blur', handleMouseLeave);
		document.documentElement.addEventListener('mouseleave', handleMouseLeave);
		return () => {
			clearHoverTimeouts();
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseout', handleMouseOut);
			window.removeEventListener('blur', handleMouseLeave);
			document.documentElement.removeEventListener(
				'mouseleave',
				handleMouseLeave,
			);
		};
	}, [smartEdges]);

	return (
		<div className="h-full flex bg-background touch-manipulation border-t border-border/50">
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

					<div className="flex">
						<div
							className={`h-full shrink-0 overflow-hidden bg-sidebar ${
								isRightPanelTransitioning
									? 'transition-[width] duration-300 ease-out'
									: 'transition-none'
							}`}
							style={rightPanelStyle}
							aria-hidden={!shouldRenderRightPanel}
						>
							<div className="h-full w-full">
								<GitSidebar onFixWithAI={onFixWithAI} />
								<SessionFilesSidebar sessionId={sessionId} />
								<SettingsSidebar onOpenDashboard={onOpenDashboard} />
								<TunnelSidebar />
								<FileBrowserSidebar />
								<MCPSidebar />
								<SkillsSidebar />
							</div>
						</div>
					</div>

					<div
						className={`relative z-40 hidden h-full shrink-0 overflow-hidden transition-[width] duration-150 ease-out md:block ${
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

				<TerminalsPanel />
			</div>

			<GitCommitModal />
			<ConfirmationDialog />
			<QuickFilePicker />
			{dashboardOpen && <UsageDashboard onBack={onCloseDashboard} />}
		</div>
	);
});
