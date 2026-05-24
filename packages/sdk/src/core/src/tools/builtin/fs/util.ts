import { createHash } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import { createTwoFilesPatch, diffLines } from 'diff';

function normalizeForComparison(value: string) {
	const withForwardSlashes = value.replace(/\\/g, '/');
	return process.platform === 'win32'
		? withForwardSlashes.toLowerCase()
		: withForwardSlashes;
}

export function resolveSafePath(projectRoot: string, p: string) {
	const root = resolvePath(projectRoot);
	const target = resolvePath(root, p || '.');
	const rootNorm = (() => {
		const normalized = normalizeForComparison(root);
		if (normalized === '/') return '/';
		return normalized.replace(/[\\/]+$/, '');
	})();
	const targetNorm = normalizeForComparison(target);
	const rootWithSlash = rootNorm === '/' ? '/' : `${rootNorm}/`;
	const inProject =
		targetNorm === rootNorm || targetNorm.startsWith(rootWithSlash);
	if (!inProject) throw new Error(`Path escapes project root: ${p}`);
	return target;
}

export function expandTilde(p: string): string {
	const home = process.env.HOME || process.env.USERPROFILE || '';
	if (!home) return p;
	if (p === '~') return home;
	if (p.startsWith('~/')) return `${home}/${p.slice(2)}`;
	return p;
}

export function isAbsoluteLike(p: string): boolean {
	return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

export function buildMutationMetadata(oldText: string, newText: string) {
	const bytesWritten = Buffer.byteLength(newText, 'utf-8');
	const { additions, deletions } = summarizeTextChanges(oldText, newText);
	return {
		bytesWritten,
		changed: oldText !== newText,
		sha256: createHash('sha256').update(newText).digest('hex'),
		summary: { files: 1, additions, deletions },
	} as const;
}

export async function buildWriteArtifact(
	relPath: string,
	existed: boolean,
	oldText: string,
	newText: string,
) {
	let patch = '';
	try {
		patch = createTwoFilesPatch(
			`a/${relPath}`,
			`b/${relPath}`,
			String(oldText ?? ''),
			String(newText ?? ''),
			'',
			'',
			{ context: 3 },
		);
	} catch {}
	if (!patch || !patch.trim().length) {
		const header = existed ? 'Update File' : 'Add File';
		const oldLines = String(oldText ?? '').split('\n');
		const newLines = String(newText ?? '').split('\n');
		const lines: string[] = [];
		lines.push('*** Begin Patch');
		lines.push(`*** ${header}: ${relPath}`);
		lines.push('@@');
		if (existed) for (const l of oldLines) lines.push(`-${l}`);
		for (const l of newLines) lines.push(`+${l}`);
		lines.push('*** End Patch');
		patch = lines.join('\n');
	}
	const { additions, deletions } = summarizeTextChanges(oldText, newText);
	return {
		kind: 'file_diff',
		patch,
		summary: { files: 1, additions, deletions },
	} as const;
}

function countDiffLines(value: string): number {
	if (value.length === 0) return 0;
	const lines = value.split('\n');
	if (value.endsWith('\n')) lines.pop();
	return lines.length;
}

export function summarizeTextChanges(
	oldText: string,
	newText: string,
): {
	additions: number;
	deletions: number;
} {
	let additions = 0;
	let deletions = 0;
	for (const part of diffLines(String(oldText ?? ''), String(newText ?? ''))) {
		const lineCount = countDiffLines(part.value);
		if (part.added) additions += lineCount;
		else if (part.removed) deletions += lineCount;
	}
	return { additions, deletions };
}
