import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
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
	MCPSidebar,
	MCPSidebarToggle,
	SkillsSidebar,
	SkillsSidebarToggle,
	QuickFilePicker,
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
} from '@ottocode/web-sdk/stores';
import { Sidebar } from './Sidebar';
import { Moon, Sun } from 'lucide-react';

const VIEWER_CHAT_WIDTH = 'clamp(360px, 28vw, 520px)';
const RIGHT_PANEL_DEFAULT_WIDTH = 320;

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
	const gitExpanded = useGitStore((s) => s.isExpanded);
	const sessionFilesExpanded = useSessionFilesStore((s) => s.isExpanded);
	const settingsExpanded = useSettingsStore((s) => s.isExpanded);
	const tunnelExpanded = useTunnelStore((s) => s.isExpanded);
	const fileBrowserExpanded = useFileBrowserStore((s) => s.isExpanded);
	const mcpExpanded = useMCPStore((s) => s.isExpanded);
	const skillsExpanded = useSkillsStore((s) => s.isExpanded);
	const viewerTabCount = useViewerTabsStore((s) => s.tabs.length);
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
	const activeRightPanelWidth = gitExpanded
		? (panelWidths.git ?? RIGHT_PANEL_DEFAULT_WIDTH)
		: sessionFilesExpanded
			? (panelWidths['session-files'] ?? RIGHT_PANEL_DEFAULT_WIDTH)
			: settingsExpanded
				? (panelWidths.settings ?? RIGHT_PANEL_DEFAULT_WIDTH)
				: fileBrowserExpanded
					? (panelWidths['file-browser'] ?? RIGHT_PANEL_DEFAULT_WIDTH)
					: RIGHT_PANEL_DEFAULT_WIDTH;
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
		width: anyViewerOpen ? VIEWER_CHAT_WIDTH : '100%',
	} as CSSProperties;
	const viewerPaneStyle = {
		width: anyViewerOpen ? `calc(100% - ${VIEWER_CHAT_WIDTH})` : '0px',
	} as CSSProperties;
	const rightPanelStyle = {
		width: `${rightPanelWidth}px`,
	} as CSSProperties;
	const shouldRenderRightPanel = anyRightPanelOpen || isRightPanelMounted;

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

	return (
		<div className="h-screen flex bg-background touch-manipulation border-t border-border/50">
			{/* Left sidebar - Sessions */}
			<Sidebar onNewSession={onNewSession}>{sidebar}</Sidebar>

			{/* Main content area with bottom terminal panel */}
			<div className="flex-1 flex flex-col overflow-hidden w-full md:w-auto">
				<div className="flex-1 flex overflow-hidden">
					<div className="flex min-w-0 flex-1 overflow-hidden">
						<main
							className={`relative shrink-0 flex-col overflow-hidden min-w-0 ${
								shouldAnimateViewer
									? 'transition-[width] duration-300 ease-out'
									: 'transition-none'
							} ${anyViewerOpen ? 'hidden md:flex md:min-w-[320px]' : 'flex'}`}
							style={mainPaneStyle}
						>
							{children}
						</main>
						<section
							className={`hidden md:flex shrink-0 min-w-0 overflow-hidden border-l bg-sidebar ${
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
							{anyViewerOpen && <ViewerTabs />}
						</section>
					</div>

					{/* Right sidebar - Git (hidden on mobile) */}
					<div className="hidden md:flex">
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
								<SettingsSidebar />
								<TunnelSidebar />
								<FileBrowserSidebar />
								<MCPSidebar />
								<SkillsSidebar />
							</div>
						</div>

						<div
							className={`flex flex-col w-12 border-l ${anyRightPanelOpen ? 'sidebar-fade-in border-sidebar-border' : 'bg-background border-border'}`}
						>
							<GitSidebarToggle />
							<SessionFilesSidebarToggle sessionId={sessionId} />
							<FileBrowserSidebarToggle />
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

			{/* Modals */}
			<GitCommitModal />
			<ConfirmationDialog />
			<QuickFilePicker />
		</div>
	);
});
