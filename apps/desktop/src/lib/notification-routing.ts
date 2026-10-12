import type { MachineBootstrap, Project } from './tauri-bridge';

export interface NotificationWorkspace {
	serverUrl: string;
	projectId: string;
	projectPath: string;
}

export interface NotificationWindowContext {
	workspace: NotificationWorkspace;
	project: Project;
	sessionId?: string;
	machine?: MachineBootstrap | null;
}

export interface NotificationSessionOpen {
	windowLabel: string;
	workspace: NotificationWorkspace;
	sessionId: string;
}

export function notificationWorkspace(
	project: Project,
	serverUrl: string,
	projectId?: string,
): NotificationWorkspace {
	return {
		serverUrl: new URL(serverUrl).toString(),
		projectId: project.projectId ?? projectId ?? '',
		projectPath: project.path,
	};
}

export function acceptsNotificationSessionOpen(
	payload: NotificationSessionOpen,
	windowLabel: string,
	workspace: NotificationWorkspace,
): boolean {
	return (
		payload.windowLabel === windowLabel &&
		payload.workspace.serverUrl === workspace.serverUrl &&
		payload.workspace.projectId === workspace.projectId &&
		payload.workspace.projectPath === workspace.projectPath
	);
}
