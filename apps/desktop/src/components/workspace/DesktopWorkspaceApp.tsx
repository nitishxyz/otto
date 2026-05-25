import {
	OnboardingModal,
	OttoRouterTopupModal,
} from '@ottocode/web-sdk/components';
import type { Theme } from '@ottocode/web-sdk/hooks';
import type { Project } from '../../lib/tauri-bridge';
import { DesktopSessionsLayout } from './DesktopSessionsLayout';
import { DesktopWorkspaceProvider } from './DesktopWorkspaceProvider';

interface DesktopWorkspaceAppProps {
	apiUrl: string;
	project: Project;
	theme: Theme;
	onToggleTheme: () => void;
	sessionId?: string;
	dashboardOpen: boolean;
	onCloseDashboard: () => void;
}

export function DesktopWorkspaceApp({
	apiUrl,
	project,
	theme,
	onToggleTheme,
	sessionId,
	dashboardOpen,
	onCloseDashboard,
}: DesktopWorkspaceAppProps) {
	return (
		<DesktopWorkspaceProvider apiUrl={apiUrl}>
			<div className="h-full min-h-0" data-project-path={project.path}>
				<DesktopSessionsLayout
					theme={theme}
					onToggleTheme={onToggleTheme}
					sessionId={sessionId}
					dashboardOpen={dashboardOpen}
					onCloseDashboard={onCloseDashboard}
				/>
				<OnboardingModal hideHeader />
				<OttoRouterTopupModal />
			</div>
		</DesktopWorkspaceProvider>
	);
}
