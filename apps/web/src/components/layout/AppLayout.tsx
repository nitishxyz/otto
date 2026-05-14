import { memo } from 'react';
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
	ResearchSidebar,
	ResearchSidebarToggle,
	SettingsSidebar,
	SettingsSidebarToggle,
	TunnelSidebar,
	TunnelSidebarToggle,
	BrowserSidebar,
	BrowserSidebarToggle,
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
	useResearchStore,
	useSettingsStore,
	useTunnelStore,
	useBrowserPanelStore,
	useFileBrowserStore,
	useMCPStore,
	useSkillsStore,
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
	onNavigateToSession,
	onFixWithAI,
}: AppLayoutProps) {
	const gitExpanded = useGitStore((s) => s.isExpanded);
	const sessionFilesExpanded = useSessionFilesStore((s) => s.isExpanded);
	const researchExpanded = useResearchStore((s) => s.isExpanded);
	const settingsExpanded = useSettingsStore((s) => s.isExpanded);
	const tunnelExpanded = useTunnelStore((s) => s.isExpanded);
	const browserExpanded = useBrowserPanelStore((s) => s.isExpanded);
	const fileBrowserExpanded = useFileBrowserStore((s) => s.isExpanded);
	const mcpExpanded = useMCPStore((s) => s.isExpanded);
	const skillsExpanded = useSkillsStore((s) => s.isExpanded);
	const anyRightPanelOpen =
		gitExpanded ||
		sessionFilesExpanded ||
		researchExpanded ||
		settingsExpanded ||
		tunnelExpanded ||
		browserExpanded ||
		fileBrowserExpanded ||
		mcpExpanded ||
		skillsExpanded;

	return (
		<div className="h-screen flex bg-background touch-manipulation border-t border-border/50">
			{/* Left sidebar - Sessions */}
			<Sidebar onNewSession={onNewSession}>{sidebar}</Sidebar>

			{/* Main content area with bottom terminal panel */}
			<div className="flex-1 flex flex-col overflow-hidden w-full md:w-auto">
				<div className="flex-1 flex overflow-hidden">
					<main className="flex-1 flex flex-col overflow-hidden relative">
						<GitDiffPanel />
						<SessionFilesDiffPanel />
						<FileViewerPanel />
						<SkillViewerPanel />
						{children}
					</main>

					{/* Right sidebar - Git (hidden on mobile) */}
					<div className="hidden md:flex">
						<GitSidebar onFixWithAI={onFixWithAI} />
						<SessionFilesSidebar sessionId={sessionId} />
						<ResearchSidebar
							parentSessionId={sessionId ?? null}
							onNavigateToSession={onNavigateToSession}
						/>
						<SettingsSidebar />
						<TunnelSidebar />
						<BrowserSidebar />
						<FileBrowserSidebar />
						<MCPSidebar />
						<SkillsSidebar />

						<div
							className={`flex flex-col w-10 border-l ${anyRightPanelOpen ? 'sidebar-fade-in border-sidebar-border' : 'bg-background border-border'}`}
						>
							<GitSidebarToggle />
							<SessionFilesSidebarToggle sessionId={sessionId} />
							<ResearchSidebarToggle parentSessionId={sessionId} />
							<FileBrowserSidebarToggle />
							<TunnelSidebarToggle />
							<BrowserSidebarToggle />
							<MCPSidebarToggle />
							<SkillsSidebarToggle />
							<SettingsSidebarToggle />
							<div className="flex-1" />
							<TerminalPanelToggle />
							<div className="h-10 border-t border-border flex items-center justify-center">
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
