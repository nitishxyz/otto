import type {
	PatchAddOperation,
	PatchDeleteOperation,
	PatchHunk,
	PatchOperation,
	PatchUpdateOperation,
} from './types.ts';

export type UnifiedBuilder =
	| (PatchAddOperation & { kind: 'add' })
	| (PatchDeleteOperation & { kind: 'delete' })
	| (PatchUpdateOperation & {
			kind: 'update';
			currentHunk: PatchHunk | null;
	  });

export function stripUnifiedPath(raw: string): string | null {
	let trimmed = raw.trim();
	if (!trimmed || trimmed === '/dev/null') return null;
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		trimmed = trimmed.slice(1, -1).replace(/\\"/g, '"');
	}
	if (trimmed.startsWith('a/') || trimmed.startsWith('b/')) {
		trimmed = trimmed.slice(2);
	}
	if (trimmed.startsWith('./')) {
		trimmed = trimmed.slice(2);
	}
	return trimmed || null;
}

export function shouldIgnoreUnifiedMetadata(line: string) {
	const trimmed = line.trim();
	if (trimmed === '') return true;
	if (trimmed === '\\ No newline at end of file') return true;
	const prefixes = [
		'diff --git',
		'index ',
		'similarity index',
		'dissimilarity index',
		'rename from',
		'rename to',
		'copy from',
		'copy to',
		'new file mode',
		'deleted file mode',
		'old mode',
		'new mode',
		'Binary files',
	];
	return prefixes.some((prefix) => trimmed.startsWith(prefix));
}

export function flushUnifiedBuilder(
	builder: UnifiedBuilder | null,
	operations: PatchOperation[],
): UnifiedBuilder | null {
	if (!builder) return null;
	if (builder.kind === 'update') {
		if (builder.currentHunk && builder.currentHunk.lines.length === 0) {
			builder.hunks.pop();
		}
		if (builder.hunks.length === 0) {
			throw new Error(
				`Update for ${builder.filePath} does not contain any diff hunks.`,
			);
		}
		operations.push({
			kind: 'update',
			filePath: builder.filePath,
			hunks: builder.hunks.map((hunk) => ({
				header: { ...hunk.header },
				lines: hunk.lines.map((line) => ({ ...line })),
			})),
		});
	} else if (builder.kind === 'add') {
		operations.push({
			kind: 'add',
			filePath: builder.filePath,
			lines: [...builder.lines],
		});
	} else {
		operations.push({ kind: 'delete', filePath: builder.filePath });
	}
	return null;
}
