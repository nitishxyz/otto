import type { PatchHunk, PatchHunkLine, PatchOperation } from './types.ts';
import { parseHunkHeader } from './hunk-header.ts';
import {
	flushUnifiedBuilder,
	shouldIgnoreUnifiedMetadata,
	stripUnifiedPath,
	type UnifiedBuilder,
} from './unified-state.ts';

export function parseUnifiedPatch(patch: string): PatchOperation[] {
	const normalized = patch.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const operations: PatchOperation[] = [];

	let builder: UnifiedBuilder | null = null;

	const flush = () => {
		builder = flushUnifiedBuilder(builder, operations);
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

			const oldPath = stripUnifiedPath(oldPathRaw);
			const newPath = stripUnifiedPath(newPathRaw);

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
			if (shouldIgnoreUnifiedMetadata(line)) continue;
			if (line.trim() === '') continue;
			throw new Error(`Unrecognized content in patch: "${line}"`);
		}

		if (builder.kind === 'add') {
			if (shouldIgnoreUnifiedMetadata(line) || line.startsWith('@@')) continue;
			if (line.startsWith('+')) {
				builder.lines.push(line.slice(1));
			}
			continue;
		}

		if (builder.kind === 'delete') {
			continue;
		}

		if (shouldIgnoreUnifiedMetadata(line)) continue;

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
