import type { Project, ServerInfo } from './tauri-bridge';

export type WorkspaceSdkConfiguration =
	| {
			kind: 'machine';
			apiUrl: string;
			projectId: string;
			projectRoot: string;
			ownerSession: string;
			ownerSessionExpiresAt: number;
	  }
	| {
			kind: 'desktop';
			apiUrl: string;
			server?: ServerInfo | null;
	  };

/** Resolves the SDK credentials that must remain active for a workspace. */
export function resolveWorkspaceSdkConfiguration(
	apiUrl: string,
	server: ServerInfo | null | undefined,
	project: Project,
): WorkspaceSdkConfiguration {
	if (
		project.remoteUrl &&
		project.projectId &&
		project.machineOwnerSession &&
		project.machineOwnerSessionExpiresAt
	) {
		return {
			kind: 'machine',
			apiUrl,
			projectId: project.projectId,
			projectRoot: project.path,
			ownerSession: project.machineOwnerSession,
			ownerSessionExpiresAt: project.machineOwnerSessionExpiresAt,
		};
	}
	return { kind: 'desktop', apiUrl, server };
}
