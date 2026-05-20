import { memo, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { Theme } from '@ottocode/web-sdk/hooks';
import {
	Button,
	ConfirmationDialog,
	FileBrowserSidebar,
	FileBrowserSidebarToggle,
	FileViewerPanel,
	GitCommitModal,
	GitDiffPanel,
	GitSidebar,
	GitSidebarToggle,
	MCPSidebar,
	MCPSidebarToggle,
	QuickFilePicker,
	ResearchSidebar,
	ResearchSidebarToggle,
	SessionFilesDiffPanel,
	SessionFilesSidebar,
	SessionFilesSidebarToggle,
	SettingsSidebar,
	SettingsSidebarToggle,
	SkillViewerPanel,
	SkillsSidebar,
	SkillsSidebarToggle,
	TerminalPanelToggle,
	TerminalsPanel,
	TunnelSidebar,
	TunnelSidebarToggle,
} from '@ottocode/web-sdk/components';
import {
	useFileBrowserStore,
	useGitStore,
	useMCPStore,
	useResearchStore,
	useSessionFilesStore,
	useSettingsStore,
	useSkillsStore,
	useTunnelStore,
} from '@ottocode/web-sdk/stores';
import { DesktopSidebar } from './DesktopSidebar';

interface DesktopAppLayoutProps {
	sidebar: ReactNode;
	children: ReactNode;
	onNewSession?: () => void;
	theme: Theme;
	onToggleTheme: () => void;
	sessionId?: string;
	onNavigateToSession?: (sessionId: string) => void;
	onFixWithAI?: (errorMessage: string) => void;
}

export const DesktopAppLayout = memo(function DesktopAppLayout({
	sidebar,
	children,
	onNewSession,
	theme,
	onToggleTheme,
	sessionId,
	onNavigateToSession,
	onFixWithAI,
}: DesktopAppLayoutProps) {
	const gitExpanded = useGitStore((s) => s.isExpanded);
	const sessionFilesExpanded = useSessionFilesStore((s) => s.isExpanded);
	const researchExpanded = useResearchStore((s) => s.isExpanded);
	const settingsExpanded = useSettingsStore((s) => s.isExpanded);
	const tunnelExpanded = useTunnelStore((s) => s.isExpanded);
	const fileBrowserExpanded = useFileBrowserStore((s) => s.isExpanded);
	const mcpExpanded = useMCPStore((s) => s.isExpanded);
	const skillsExpanded = useSkillsStore((s) => s.isExpanded);
	const anyRightPanelOpen =
		gitExpanded ||
		sessionFilesExpanded ||
		researchExpanded ||
		settingsExpanded ||
		tunnelExpanded ||
		fileBrowserExpanded ||
		mcpExpanded ||
		skillsExpanded;

	return (
		<div className="h-full flex bg-background touch-manipulation border-t border-border/50">
			<DesktopSidebar onNewSession={onNewSession}>{sidebar}</DesktopSidebar>

			<div className="flex-1 flex flex-col overflow-hidden w-full md:w-auto">
				<div className="flex-1 flex overflow-hidden">
					<main className="flex-1 flex flex-col overflow-hidden relative">
						<GitDiffPanel />
						<SessionFilesDiffPanel />
						<FileViewerPanel />
						<SkillViewerPanel />
						{children}
					</main>

					<div className="hidden md:flex">
						<GitSidebar onFixWithAI={onFixWithAI} />
						<SessionFilesSidebar sessionId={sessionId} />
						<ResearchSidebar
							parentSessionId={sessionId ?? null}
							onNavigateToSession={onNavigateToSession}
						/>
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
							<ResearchSidebarToggle parentSessionId={sessionId} />
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

				<TerminalsPanel />
			</div>

			<GitCommitModal />
			<ConfirmationDialog />
			<QuickFilePicker />
		</div>
	);
});
