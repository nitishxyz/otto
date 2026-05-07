import type {
	PatchAddOperation,
	PatchDeleteOperation,
	PatchHunk,
	PatchHunkLine,
	PatchOperation,
	PatchUpdateOperation,
} from './types.ts';
import { parseHunkHeader } from './hunk-header.ts';

function stripPath(raw: string): string | null {
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

function shouldIgnoreMetadata(line: string) {
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

export function parseUnifiedPatch(patch: string): PatchOperation[] {
	const normalized = patch.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const operations: PatchOperation[] = [];

	type Builder =
		| (PatchAddOperation & { kind: 'add' })
		| (PatchDeleteOperation & { kind: 'delete' })
		| (PatchUpdateOperation & {
				kind: 'update';
				currentHunk: PatchHunk | null;
		  });

	let builder: Builder | null = null;

	const flush = () => {
		if (!builder) return;
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
		builder = null;
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (line.startsWith('--- ')) {
			const oldPathRaw = line.slice(4);
			const next = lines[i + 1];
			if (!next?.startsWith('+++ ')) {
				throw new Error(
					'Invalid unified diff: expected "+++ <path>" after "--- <path>"',
				);
			}
			const newPathRaw = next.slice(4);
			i += 1;

			flush();

			const oldPath = stripPath(oldPathRaw);
			const newPath = stripPath(newPathRaw);

			if (!oldPath && !newPath) {
				throw new Error(
					'Invalid unified diff: missing file paths after ---/+++ headers.',
				);
			}

			if (!oldPath) {
				if (!newPath) {
					throw new Error(
						'Invalid unified diff: missing target path for added file.',
					);
				}
				builder = {
					kind: 'add',
					filePath: newPath,
					lines: [],
				};
				continue;
			}

			if (!newPath) {
				builder = {
					kind: 'delete',
					filePath: oldPath,
				};
				continue;
			}

			if (oldPath !== newPath) {
				throw new Error(
					`Renames are not supported in apply_patch. Old path: ${oldPath}, new path: ${newPath}`,
				);
			}

			builder = {
				kind: 'update',
				filePath: newPath,
				hunks: [],
				currentHunk: null,
			};
			continue;
		}

		if (!builder) {
			if (shouldIgnoreMetadata(line)) continue;
			if (line.trim() === '') continue;
			throw new Error(`Unrecognized content in patch: "${line}"`);
		}

		if (builder.kind === 'add') {
			if (shouldIgnoreMetadata(line) || line.startsWith('@@')) continue;
			if (line.startsWith('+')) {
				builder.lines.push(line.slice(1));
			}
			continue;
		}

		if (builder.kind === 'delete') {
			continue;
		}

		if (shouldIgnoreMetadata(line)) continue;

		if (line.startsWith('@@')) {
			const hunk: PatchHunk = { header: parseHunkHeader(line), lines: [] };
			builder.hunks.push(hunk);
			builder.currentHunk = hunk;
			continue;
		}

		if (!builder.currentHunk) {
			const fallback: PatchHunk = { header: {}, lines: [] };
			builder.hunks.push(fallback);
			builder.currentHunk = fallback;
		}

		const hunk = builder.currentHunk;
		const prefix = line[0];
		const getLine = (kind: PatchHunkLine['kind'], content: string) => ({
			kind,
			content,
		});

		if (prefix === '+') {
			hunk.lines.push(getLine('add', line.slice(1)));
		} else if (prefix === '-') {
			hunk.lines.push(getLine('remove', line.slice(1)));
		} else if (prefix === ' ') {
			hunk.lines.push(getLine('context', line.slice(1)));
		} else {
			hunk.lines.push(getLine('context', line));
		}
	}

	flush();

	if (operations.length === 0) {
		throw new Error('No operations found in unified diff.');
	}

	return operations;
}
