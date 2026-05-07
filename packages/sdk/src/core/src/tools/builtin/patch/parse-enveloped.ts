import {
	PATCH_ADD_PREFIX,
	PATCH_BEGIN_MARKER,
	PATCH_DELETE_PREFIX,
	PATCH_END_MARKER,
	PATCH_FIND_MARKER,
	PATCH_REPLACE_PREFIX,
	PATCH_UPDATE_PREFIX,
	PATCH_WITH_MARKER,
} from './constants.ts';
import { parseHunkHeader } from './hunk-header.ts';
import type {
	PatchAddOperation,
	PatchDeleteOperation,
	PatchHunk,
	PatchHunkLine,
	PatchOperation,
	PatchUpdateOperation,
} from './types.ts';

function parseDirectivePath(line: string, prefix: string): string {
	const filePath = line.slice(prefix.length).trim();
	if (!filePath) {
		throw new Error(`Missing file path for directive: ${line}`);
	}
	if (filePath.startsWith('/') || filePath.includes('..')) {
		throw new Error('Patch file paths must be relative to the project root.');
	}
	return filePath;
}

interface ReplaceBuilder {
	kind: 'replace';
	filePath: string;
	hunks: PatchHunk[];
	phase: 'idle' | 'find' | 'with';
	findLines: string[];
	withLines: string[];
}

function flushReplacePair(builder: ReplaceBuilder) {
	if (builder.findLines.length === 0 && builder.withLines.length === 0) return;
	if (builder.findLines.length === 0) {
		throw new Error(
			`Replace in ${builder.filePath}: *** Find: block is empty.`,
		);
	}
	const lines: PatchHunkLine[] = [];
	for (const line of builder.findLines) {
		lines.push({ kind: 'remove', content: line });
	}
	for (const line of builder.withLines) {
		lines.push({ kind: 'add', content: line });
	}
	builder.hunks.push({ header: {}, lines });
	builder.findLines = [];
	builder.withLines = [];
	builder.phase = 'idle';
}

function flushReplaceBuilder(builder: ReplaceBuilder): PatchUpdateOperation {
	flushReplacePair(builder);
	if (builder.hunks.length === 0) {
		throw new Error(
			`Replace in ${builder.filePath} does not contain any *** Find:/*** With: pairs.`,
		);
	}
	return {
		kind: 'update',
		filePath: builder.filePath,
		hunks: builder.hunks.map((hunk) => ({
			header: { ...hunk.header },
			lines: hunk.lines.map((line) => ({ ...line })),
		})),
	};
}

export function parseEnvelopedPatch(patch: string): PatchOperation[] {
	const normalized = patch.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const operations: PatchOperation[] = [];

	type Builder =
		| (PatchAddOperation & { kind: 'add' })
		| (PatchDeleteOperation & { kind: 'delete' })
		| (PatchUpdateOperation & {
				kind: 'update';
				currentHunk: PatchHunk | null;
		  })
		| ReplaceBuilder;

	let builder: Builder | null = null;
	let inside = false;
	let encounteredEnd = false;

	const flushBuilder = () => {
		if (!builder) return;
		if (builder.kind === 'replace') {
			operations.push(flushReplaceBuilder(builder));
		} else if (builder.kind === 'update') {
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

		if (!inside) {
			if (line.trim() === '') continue;
			if (line.startsWith(PATCH_BEGIN_MARKER)) {
				inside = true;
				continue;
			}
			throw new Error(
				'Patch must start with "*** Begin Patch" and use the enveloped patch format.',
			);
		}

		if (line.startsWith(PATCH_BEGIN_MARKER)) {
			throw new Error('Nested "*** Begin Patch" markers are not supported.');
		}

		if (line.startsWith(PATCH_END_MARKER)) {
			flushBuilder();
			encounteredEnd = true;
			const remaining = lines.slice(i + 1).find((rest) => rest.trim() !== '');
			if (remaining) {
				throw new Error(
					'Unexpected content found after "*** End Patch" marker.',
				);
			}
			break;
		}

		if (line.startsWith(PATCH_ADD_PREFIX)) {
			flushBuilder();
			builder = {
				kind: 'add',
				filePath: parseDirectivePath(line, PATCH_ADD_PREFIX),
				lines: [],
			};
			continue;
		}

		if (line.startsWith(PATCH_UPDATE_PREFIX)) {
			flushBuilder();
			builder = {
				kind: 'update',
				filePath: parseDirectivePath(line, PATCH_UPDATE_PREFIX),
				hunks: [],
				currentHunk: null,
			};
			continue;
		}

		if (line.startsWith(PATCH_DELETE_PREFIX)) {
			flushBuilder();
			builder = {
				kind: 'delete',
				filePath: parseDirectivePath(line, PATCH_DELETE_PREFIX),
			};
			continue;
		}

		if (line.startsWith(PATCH_REPLACE_PREFIX)) {
			flushBuilder();
			builder = {
				kind: 'replace',
				filePath: parseDirectivePath(line, PATCH_REPLACE_PREFIX),
				hunks: [],
				phase: 'idle',
				findLines: [],
				withLines: [],
			};
			continue;
		}

		if (builder && builder.kind === 'replace') {
			if (line.startsWith(PATCH_FIND_MARKER)) {
				flushReplacePair(builder);
				builder.phase = 'find';
				continue;
			}
			if (line.startsWith(PATCH_WITH_MARKER)) {
				if (builder.phase !== 'find' || builder.findLines.length === 0) {
					throw new Error(
						`Replace in ${builder.filePath}: *** With: must follow a non-empty *** Find: block.`,
					);
				}
				builder.phase = 'with';
				continue;
			}
			if (builder.phase === 'find') {
				builder.findLines.push(line);
				continue;
			}
			if (builder.phase === 'with') {
				builder.withLines.push(line);
				continue;
			}
			if (line.trim() === '') continue;
			throw new Error(
				`Replace in ${builder.filePath}: expected *** Find: or *** With: directive, got "${line}"`,
			);
		}

		if (!builder) {
			if (line.trim() === '') continue;
			throw new Error(`Unexpected content in patch: "${line}"`);
		}

		if (builder.kind === 'add') {
			builder.lines.push(line.startsWith('+') ? line.slice(1) : line);
			continue;
		}

		if (builder.kind === 'delete') {
			if (line.trim() !== '') {
				throw new Error(
					`Delete directive for ${builder.filePath} should not contain additional lines.`,
				);
			}
			continue;
		}

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
		const createLine = (kind: PatchHunkLine['kind'], content: string) => ({
			kind,
			content,
		});

		if (/^-{3,}\s*$/.test(line)) {
			hunk.lines.push(createLine('context', line));
		} else if (prefix === '+') {
			hunk.lines.push(createLine('add', line.slice(1)));
		} else if (prefix === '-') {
			hunk.lines.push(createLine('remove', line.slice(1)));
		} else if (prefix === ' ') {
			hunk.lines.push(createLine('context', line.slice(1)));
		} else {
			hunk.lines.push(createLine('context', line));
		}
	}

	if (!encounteredEnd) {
		throw new Error('Missing "*** End Patch" marker.');
	}

	return operations;
}
