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
		lastOpened: new Date(project.lastUsedAt || now.getTime()).toISOString(),
		pinned: project.pinned ?? false,
		kind: project.name.toLowerCase() === 'general' ? 'general' : 'remote',
		remoteUrl: apiUrl,
		projectId: project.id,
		machineOwnerSession: ownerSession,
		machineOwnerSessionExpiresAt: ownerSessionExpiresAt,
	};
}

/**
 * Label for the remote host badge in the desktop title bar.
 * Prefers the machine display name, then tunnel hostname, then the remote URL host.
 */
export function resolveRemoteHostLabel(options: {
	name?: string | null;
	hostname?: string | null;
	remoteUrl?: string | null;
	fallback?: string;
}): string {
	const name = options.name?.trim();
	if (name) return name;
	const hostname = options.hostname?.trim();
	if (hostname) return hostname;
	const remoteUrl = options.remoteUrl?.trim();
	if (remoteUrl) {
		try {
			const host = new URL(remoteUrl).hostname.trim();
			if (host) return host;
		} catch {
			// Invalid remote URL; fall through to the badge fallback.
		}
	}
	return options.fallback ?? 'Remote';
}
