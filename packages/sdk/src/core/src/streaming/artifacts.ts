// Shared types and helpers for tool artifacts persisted in message parts.

export type FileDiffArtifact = {
	kind: 'file_diff';
	patchFormat: 'unified';
	patch: string; // full unified patch text
	summary?: { files?: number; additions?: number; deletions?: number };
};

export type FileArtifact = {
	kind: 'file';
	path: string; // repository-relative path
	mime?: string;
	size?: number;
	sha256?: string;
};

export type MiniAppArtifact = {
	kind: 'mini_app';
	schemaVersion: 1;
	appId: string;
	name: string;
	description?: string;
	runtime: 'otto-react';
	root: string;
	entry: string;
	contentHash: string;
	revisionId: string;
	availability: {
		global: boolean;
		project: boolean;
		requiresProject: boolean;
	};
	permissions: string[];
	capabilities: string[];
	placements: Array<'apps' | 'project' | 'commandPalette'>;
	previewUrl?: string;
	previewPath?: string;
};

export type ReactArtifact = {
	kind: 'artifact';
	schemaVersion: 1;
	artifactId: string;
	title: string;
	description?: string;
	runtime: 'otto-react-artifact';
	contentHash: string;
	revisionId: string;
	previewPath: string;
	libraries: string[];
};

export type Artifact =
	| FileDiffArtifact
	| FileArtifact
	| ReactArtifact
	| MiniAppArtifact
	| { kind: string; [k: string]: unknown };

export function createFileDiffArtifact(
	patch: string,
	summary?: { files?: number; additions?: number; deletions?: number },
): FileDiffArtifact {
	return { kind: 'file_diff', patchFormat: 'unified', patch, summary };
}

export function createToolResultPayload(
	name: string,
	result?: unknown,
	artifact?: Artifact,
) {
	const payload: { name: string; result?: unknown; artifact?: Artifact } = {
		name,
	};
	if (result !== undefined) payload.result = result;
	if (artifact) payload.artifact = artifact;
	return payload;
}
