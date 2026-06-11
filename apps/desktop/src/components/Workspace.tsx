import { useEffect, useRef } from 'react';
import { useServer } from '../hooks/useServer';
import type { Project } from '../lib/tauri-bridge';
import { OttoRouterLoader } from './OttoRouterLoader';
import { useDesktopTheme } from '../theme';
import { DesktopTitleBar } from './workspace/DesktopTitleBar';
import { DesktopWorkspaceApp } from './workspace/DesktopWorkspaceApp';

function closeActiveWorkspaceOverlay() {
	const event = new CustomEvent('otto:native-back', {
		cancelable: true,
		detail: { handled: false },
	});
	window.dispatchEvent(event);
	return event.defaultPrevented;
}

export function Workspace({
	project,
	onBack,
	sessionId,
	view,
	dashboardOpen,
	onCloseDashboard,
}: {
	project: Project;
	onBack: () => void | Promise<void>;
	sessionId?: string;
	view?: 'agents' | 'otto';
	dashboardOpen: boolean;
	onCloseDashboard: () => void;
}) {
	const { server, loading, error, startServer, stopServer } = useServer();
	const startedRef = useRef(false);
	const { theme, toggleTheme } = useDesktopTheme();
	const isRemote = !!project.remoteUrl;
	const workspaceApiUrl = isRemote
		? project.remoteUrl
		: server
			? `http://localhost:${server.port}`
			: null;

	const handleBack = async () => {
		if (closeActiveWorkspaceOverlay()) return;

		await stopServer();
		onBack();
	};

	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;
		if (!isRemote) {
			startServer(project.path);
		}
	}, [project.path, isRemote, startServer]);

	const showApp = !!workspaceApiUrl && !error;

	return (
		<div className="h-screen flex flex-col bg-background">
			{/* Fallback bar while the app (and its query provider) isn't mounted */}
			{!showApp && (
				<DesktopTitleBar
					projectName={project.name}
					onBack={handleBack}
					serverPort={server?.port}
					isRemote={isRemote}
					showTabs={false}
				/>
			)}

			<div className="flex-1 min-h-0 relative bg-background">
				{loading && (
					<div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
						<OttoRouterLoader label="Starting server..." />
					</div>
				)}
				{error && !loading && (
					<div className="h-full flex items-center justify-center">
						<div className="text-center max-w-md">
							<div className="text-destructive mb-4">{error}</div>
							<button
								type="button"
								onClick={() => {
									startedRef.current = false;
									if (!isRemote) {
										startServer(project.path);
									}
								}}
								className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
							>
								Retry
							</button>
						</div>
					</div>
				)}
				{showApp && (
					<DesktopWorkspaceApp
						key={`${workspaceApiUrl}:${project.path}`}
						apiUrl={workspaceApiUrl}
						project={project}
						theme={theme}
						onToggleTheme={toggleTheme}
						sessionId={sessionId}
						view={view}
						dashboardOpen={dashboardOpen}
						onCloseDashboard={onCloseDashboard}
						titleBar={
							<DesktopTitleBar
								projectName={project.name}
								onBack={handleBack}
								serverPort={server?.port}
								isRemote={isRemote}
							/>
						}
					/>
				)}
			</div>
		</div>
	);
}
