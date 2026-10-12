import type { NotificationWindowContext } from './notification-routing';
import type {
	MachineBootstrap,
	MachineProjectAccess,
	Project,
} from './tauri-bridge';

/** Reauthorizes captured machine routing without retaining notification credentials. */
export async function restoreNotificationProject(
	notification: NotificationWindowContext,
	machine: MachineBootstrap | null,
	localDaemonUrl: string,
	authorize: (
		machine: MachineBootstrap,
		localDaemonUrl: string,
		forceOwnerSession: boolean,
	) => Promise<MachineProjectAccess>,
): Promise<Project> {
	const captured = notification.machine;
	if (!captured) return notification.project;
	if (
		!machine ||
		machine.machineId !== captured.machineId ||
		machine.deviceId !== captured.deviceId
	) {
		throw new Error('Notification machine routing changed.');
	}
	const access = await authorize({ ...machine }, localDaemonUrl, true);
	if (access.status !== 'ready') throw new Error(access.message);
	const project = access.projects.find(
		(candidate) =>
			candidate.id === notification.workspace.projectId &&
			candidate.path === notification.workspace.projectPath,
	);
	if (!project) throw new Error('Notification project is no longer available.');
	return {
		...notification.project,
		projectId: project.id,
		path: project.path,
		remoteUrl: access.apiUrl,
		machineOwnerSession: access.ownerSession,
		machineOwnerSessionExpiresAt: access.ownerSessionExpiresAt,
	};
}
