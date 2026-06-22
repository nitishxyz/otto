import type { FileOperation, ToolResultData } from './types.ts';

function addUniquePath(paths: string[], path: string | undefined): void {
	const normalized = path?.trim();
	if (normalized && !paths.includes(normalized)) paths.push(normalized);
}

function stripUnifiedHeaderMetadata(path: string): string {
	return path.split(/\s+/)[0] ?? path;
}

function extractPathsFromPatch(patch: string): string[] {
	const paths: string[] = [];
	const envelopedDirective = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;
	for (const match of patch.matchAll(envelopedDirective)) {
		addUniquePath(paths, match[1]);
	}

	const lineDirective =
		/^\*\*\* (?:Replace in|Delete Lines in|Replace Lines in|Insert Before in|Insert After in): (.+)$/gm;
	for (const match of patch.matchAll(lineDirective)) {
		addUniquePath(paths, match[1]);
	}

	const unifiedFile = /^(?:---|\+\+\+) (?:[ab]\/)?(.+)$/gm;
	for (const match of patch.matchAll(unifiedFile)) {
		const path = stripUnifiedHeaderMetadata(match[1]?.trim() ?? '');
		if (!path || path === '/dev/null') continue;
		addUniquePath(paths, path);
	}

	return paths;
}

export function extractFilePathsFromToolCall(
	toolName: string,
	content: unknown,
): string[] {
	if (!content || typeof content !== 'object') return [];

	const c = content as Record<string, unknown>;
	const args = c.args as Record<string, unknown> | undefined;
	const name = toolName.toLowerCase();
	const paths: string[] = [];

	if (name === 'write' || name === 'edit' || name === 'multiedit') {
		addUniquePath(paths, args?.path as string | undefined);
		addUniquePath(paths, c.path as string | undefined);
	}
	if (name === 'copyinto' || name === 'copy_into') {
		addUniquePath(paths, args?.targetPath as string | undefined);
		addUniquePath(paths, c.targetPath as string | undefined);
	}

	if (name === 'applypatch' || name === 'apply_patch') {
		const patch = args?.patch ?? c.patch;
		if (typeof patch === 'string') {
			for (const path of extractPathsFromPatch(patch))
				addUniquePath(paths, path);
		}
		addUniquePath(paths, args?.path as string | undefined);
		addUniquePath(paths, c.path as string | undefined);
	}

	return paths;
}

export function extractFilePathFromToolCall(
	toolName: string,
	content: unknown,
): string | null {
	const paths = extractFilePathsFromToolCall(toolName, content);
	if (paths.length > 0) return paths[0];

	if (!content || typeof content !== 'object') return null;

	const c = content as Record<string, unknown>;
	const args = c.args as Record<string, unknown> | undefined;

	const name = toolName.toLowerCase();

	if (name === 'write' || name === 'edit' || name === 'multiedit') {
		if (args && typeof args.path === 'string') return args.path;
		if (typeof c.path === 'string') return c.path;
	}
	if (name === 'copyinto' || name === 'copy_into') {
		if (args && typeof args.targetPath === 'string') return args.targetPath;
		if (typeof c.targetPath === 'string') return c.targetPath;
	}

	if (name === 'applypatch' || name === 'apply_patch') {
		const patch = args?.patch ?? c.patch;
		if (typeof patch === 'string') {
			const patchPaths = extractPathsFromPatch(patch);
			if (patchPaths.length > 0) return patchPaths[0];
		}
		if (args && typeof args.path === 'string') return args.path;
		if (typeof c.path === 'string') return c.path;
	}

	return null;
}

export function extractPatchFromToolCall(
	toolName: string,
	content: unknown,
): string | undefined {
	if (!content || typeof content !== 'object') return undefined;

	const c = content as Record<string, unknown>;
	const args = c.args as Record<string, unknown> | undefined;
	const name = toolName.toLowerCase();

	if (name === 'applypatch' || name === 'apply_patch') {
		const patch = args?.patch ?? c.patch;
		if (typeof patch === 'string') return patch;
	}

	return undefined;
}

export function extractContentFromToolCall(
	toolName: string,
	content: unknown,
): string | undefined {
	if (!content || typeof content !== 'object') return undefined;

	const c = content as Record<string, unknown>;
	const args = c.args as Record<string, unknown> | undefined;
	const name = toolName.toLowerCase();

	if (name === 'write') {
		const writeContent = args?.content ?? c.content;
		if (typeof writeContent === 'string') return writeContent;
	}

	return undefined;
}

export function extractFilesFromToolResult(
	toolName: string,
	content: unknown,
): string[] {
	if (!content || typeof content !== 'object') return [];

	const c = content as ToolResultData;
	const files: string[] = [];

	if (typeof c.path === 'string') {
		files.push(c.path);
	}

	const args = c.args;
	if (args && typeof args.path === 'string' && !files.includes(args.path)) {
		files.push(args.path);
	}
	if (
		args &&
		typeof args.targetPath === 'string' &&
		!files.includes(args.targetPath)
	) {
		files.push(args.targetPath);
	}
	if (typeof c.targetPath === 'string' && !files.includes(c.targetPath)) {
		files.push(c.targetPath);
	}

	if (Array.isArray(c.files)) {
		for (const f of c.files) {
			if (typeof f === 'string' && !files.includes(f)) files.push(f);
			if (f && typeof f === 'object' && typeof f.path === 'string') {
				if (!files.includes(f.path)) files.push(f.path);
			}
		}
	}

	const name = toolName.toLowerCase();
	if (name === 'applypatch' || name === 'apply_patch') {
		const patch =
			c.patch ??
			(args?.patch as string | undefined) ??
			c.result?.artifact?.patch;
		if (typeof patch === 'string') {
			for (const path of extractPathsFromPatch(patch))
				addUniquePath(files, path);
		}
	}

	return files;
}

export function extractDataFromToolResult(
	toolName: string,
	content: unknown,
): {
	patch?: string;
	writeContent?: string;
	artifact?: FileOperation['artifact'];
} {
	if (!content || typeof content !== 'object') return {};

	const c = content as ToolResultData;
	const args = c.args as Record<string, unknown> | undefined;
	const name = toolName.toLowerCase();

	let patch: string | undefined;
	let writeContent: string | undefined;
	let artifact: FileOperation['artifact'] | undefined;

	if (name === 'applypatch' || name === 'apply_patch') {
		patch = (args?.patch as string | undefined) ?? c.patch;
	}

	if (
		(name === 'edit' || name === 'multiedit' || name === 'copy_into') &&
		typeof c.result?.artifact?.patch === 'string'
	) {
		patch = c.result.artifact.patch;
	}

	if (name === 'write') {
		writeContent = args?.content as string | undefined;
	}

	const rawArtifact = c.result?.artifact ?? c.artifact;
	if (rawArtifact && typeof rawArtifact === 'object') {
		artifact = {
			kind: rawArtifact.kind || 'unknown',
			patch: rawArtifact.patch,
			summary: rawArtifact.summary
				? {
						additions: rawArtifact.summary.additions || 0,
						deletions: rawArtifact.summary.deletions || 0,
					}
				: undefined,
		};
	}

	return { patch, writeContent, artifact };
}

export function getOperationType(
	toolName: string,
): 'write' | 'patch' | 'create' {
	const name = toolName.toLowerCase();
	if (name === 'write') return 'write';
	if (name === 'edit' || name === 'multiedit' || name === 'copy_into') {
		return 'patch';
	}
	if (name === 'applypatch' || name === 'apply_patch') return 'patch';
	return 'write';
}
