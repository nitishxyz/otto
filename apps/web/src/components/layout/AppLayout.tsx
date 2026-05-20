import { memo, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Theme } from '@ottocode/web-sdk/hooks';
import {
	GitSidebarToggle,
	GitSidebar,
	TerminalPanelToggle,
	TerminalsPanel,
	GitDiffPanel,
	GitCommitModal,
	ConfirmationDialog,
	Button,
	SessionFilesSidebarToggle,
	SessionFilesSidebar,
	SessionFilesDiffPanel,
	SettingsSidebar,
	SettingsSidebarToggle,
	TunnelSidebar,
	TunnelSidebarToggle,
	FileBrowserSidebar,
	FileBrowserSidebarToggle,
	FileViewerPanel,
	MCPSidebar,
	MCPSidebarToggle,
	SkillsSidebar,
	SkillsSidebarToggle,
	SkillViewerPanel,
	QuickFilePicker,
} from '@ottocode/web-sdk/components';
import {
	useGitStore,
	useSessionFilesStore,
	useSettingsStore,
	useTunnelStore,
	useFileBrowserStore,
	useMCPStore,
	useSkillsStore,
	useSidebarStore,
} from '@ottocode/web-sdk/stores';
import { Sidebar } from './Sidebar';
import { Moon, Sun } from 'lucide-react';

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
	const gitDiffOpen = useGitStore((s) => s.isDiffOpen);
	const sessionFilesExpanded = useSessionFilesStore((s) => s.isExpanded);
	const sessionFilesDiffOpen = useSessionFilesStore((s) => s.isDiffOpen);
	const settingsExpanded = useSettingsStore((s) => s.isExpanded);
	const tunnelExpanded = useTunnelStore((s) => s.isExpanded);
	const fileBrowserExpanded = useFileBrowserStore((s) => s.isExpanded);
	const fileViewerOpen = useFileBrowserStore((s) => s.isViewerOpen);
	const mcpExpanded = useMCPStore((s) => s.isExpanded);
	const skillsExpanded = useSkillsStore((s) => s.isExpanded);
	const skillViewerOpen = useSkillsStore((s) => s.isViewerOpen);
	const setSessionsCollapsed = useSidebarStore((s) => s.setCollapsed);
	const anyRightPanelOpen =
		gitExpanded ||
		sessionFilesExpanded ||
		settingsExpanded ||
		tunnelExpanded ||
		fileBrowserExpanded ||
		mcpExpanded ||
		skillsExpanded;
	const anyViewerOpen =
		gitDiffOpen || sessionFilesDiffOpen || fileViewerOpen || skillViewerOpen;
	const anyRightSurfaceOpen = anyRightPanelOpen || anyViewerOpen;

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

	return (
		<div className="h-screen flex bg-background touch-manipulation border-t border-border/50">
			{/* Left sidebar - Sessions */}
			<Sidebar onNewSession={onNewSession}>{sidebar}</Sidebar>

			{/* Main content area with bottom terminal panel */}
			<div className="flex-1 flex flex-col overflow-hidden w-full md:w-auto">
				<div className="flex-1 flex overflow-hidden">
					<main
						className={
							anyViewerOpen
								? 'relative hidden md:flex shrink-0 basis-[clamp(360px,28vw,520px)] min-w-[320px] flex-col overflow-hidden'
								: 'relative flex-1 flex flex-col overflow-hidden min-w-0'
						}
					>
						{children}
					</main>
					{anyViewerOpen && (
						<section className="flex flex-1 min-w-0 md:border-l md:border-sidebar-border bg-sidebar">
							<GitDiffPanel mode="pane" />
							<SessionFilesDiffPanel mode="pane" />
							<FileViewerPanel mode="pane" />
							<SkillViewerPanel mode="pane" />
						</section>
					)}

					{/* Right sidebar - Git (hidden on mobile) */}
					<div className="hidden md:flex">
						<GitSidebar onFixWithAI={onFixWithAI} />
						<SessionFilesSidebar sessionId={sessionId} />
						<SettingsSidebar />
						<TunnelSidebar />
						<FileBrowserSidebar />
						<MCPSidebar />
						<SkillsSidebar />

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
