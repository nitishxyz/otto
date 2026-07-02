import {
	OnboardingModal,
	OttoRouterTopupModal,
} from '@ottocode/web-sdk/components';
import type { ReactNode } from 'react';
import type { Project, ServerInfo } from '../../lib/tauri-bridge';
import { DesktopSessionsLayout } from './DesktopSessionsLayout';
import { DesktopWorkspaceProvider } from './DesktopWorkspaceProvider';

interface DesktopWorkspaceAppProps {
	apiUrl: string;
	server?: ServerInfo | null;
	project: Project;
	sessionId?: string;
	view?: 'agents' | 'looper';
	dashboardOpen: boolean;
	onCloseDashboard: () => void;
	titleBar?: ReactNode;
}

export function DesktopWorkspaceApp({
	apiUrl,
	server,
	project,
	sessionId,
	view,
	dashboardOpen,
	onCloseDashboard,
	titleBar,
}: DesktopWorkspaceAppProps) {
	return (
		<DesktopWorkspaceProvider apiUrl={apiUrl} server={server}>
			<div className="h-full min-h-0" data-project-path={project.path}>
				<DesktopSessionsLayout
					project={project}
					sessionId={sessionId}
					view={view}
					dashboardOpen={dashboardOpen}
					onCloseDashboard={onCloseDashboard}
					titleBar={titleBar}
				/>
				<OnboardingModal hideHeader />
				<OttoRouterTopupModal />
			</div>
		</DesktopWorkspaceProvider>
	);
}
