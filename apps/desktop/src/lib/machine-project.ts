import type { MachineProject, Project } from './tauri-bridge';

/** Builds renderer-memory-only project context for an authorized machine window. */
export function toConnectedProject(
	project: MachineProject,
	apiUrl: string,
	ownerSession: string,
	ownerSessionExpiresAt: number,
	now = new Date(),
): Project {
	return {
		path: project.path,
		name: project.name,
		lastOpened: now.toISOString(),
		pinned: false,
		kind: 'remote',
		remoteUrl: apiUrl,
		projectId: project.id,
		machineOwnerSession: ownerSession,
		machineOwnerSessionExpiresAt: ownerSessionExpiresAt,
	};
}
