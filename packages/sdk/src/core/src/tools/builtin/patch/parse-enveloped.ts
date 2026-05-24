import {
	PATCH_ADD_PREFIX,
	PATCH_BEGIN_MARKER,
	PATCH_DELETE_PREFIX,
	PATCH_DELETE_LINES_PREFIX,
	PATCH_END_MARKER,
	PATCH_FIND_MARKER,
	PATCH_INSERT_AFTER_PREFIX,
	PATCH_INSERT_BEFORE_PREFIX,
	PATCH_LINE_MARKER,
	PATCH_LINES_MARKER,
	PATCH_REPLACE_LINES_PREFIX,
	PATCH_REPLACE_PREFIX,
	PATCH_UPDATE_PREFIX,
	PATCH_WITH_MARKER,
} from './constants.ts';
import { parseHunkHeader } from './hunk-header.ts';
import {
	createReplaceBuilder,
	flushReplaceBuilder,
	flushReplacePair,
	type ReplaceBuilder,
} from './replace-builder.ts';
import type {
	PatchAddOperation,
	PatchDeleteOperation,
	PatchHunk,
	PatchHunkLine,
	PatchLineDeleteOperation,
	PatchLineInsertOperation,
	PatchLineReplaceOperation,
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

function parsePositiveLineNumber(value: string, label: string): number {
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) {
		throw new Error(`${label} must be a positive integer.`);
	}
	const line = Number.parseInt(trimmed, 10);
	if (line < 1) {
		throw new Error(`${label} must be a positive integer.`);
	}
	return line;
}

function parseLineRange(value: string): {
	startLine: number;
	endLine: number | 'end';
} {
	const trimmed = value.trim();
	const match = /^(\d+)(?:\s*-\s*(\d+|end|eof|\$))?$/i.exec(trimmed);
	if (!match) {
		throw new Error(
			'Line ranges must use "start" or "start-end" with 1-indexed positive integers.',
		);
	}

	const startLine = parsePositiveLineNumber(match[1], 'Line range start');
	const endLineToken = match[2];
	if (!endLineToken) return { startLine, endLine: startLine };
	const endLine = /^(end|eof|\$)$/i.test(endLineToken)
		? 'end'
		: parsePositiveLineNumber(endLineToken, 'Line range end');
	if (typeof endLine === 'number' && endLine < startLine) {
		throw new Error('Line range end must be greater than or equal to start.');
	}
	return { startLine, endLine };
}

type LineDeleteBuilder = Partial<PatchLineDeleteOperation> & {
	kind: 'line-delete';
	filePath: string;
};

type LineReplaceBuilder = Partial<PatchLineReplaceOperation> & {
	kind: 'line-replace';
	filePath: string;
	lines: string[];
	phase: 'range' | 'with';
};

type LineInsertBuilder = Partial<PatchLineInsertOperation> & {
	kind: 'line-insert';
	filePath: string;
	position: 'before' | 'after';
	lines: string[];
	phase: 'line' | 'with';
};

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
		| LineDeleteBuilder
		| LineReplaceBuilder
		| LineInsertBuilder
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
		} else if (builder.kind === 'line-delete') {
			if (!builder.startLine || !builder.endLine) {
				throw new Error(
					`Delete Lines in ${builder.filePath}: missing required *** Lines: directive.`,
				);
			}
			operations.push({
				kind: 'line-delete',
				filePath: builder.filePath,
				startLine: builder.startLine,
				endLine: builder.endLine,
			});
		} else if (builder.kind === 'line-replace') {
			if (!builder.startLine || !builder.endLine) {
				throw new Error(
					`Replace Lines in ${builder.filePath}: missing required *** Lines: directive.`,
				);
			}
			if (builder.phase !== 'with') {
				throw new Error(
					`Replace Lines in ${builder.filePath}: missing required *** With: directive.`,
				);
			}
			operations.push({
				kind: 'line-replace',
				filePath: builder.filePath,
				startLine: builder.startLine,
				endLine: builder.endLine,
				lines: [...builder.lines],
			});
		} else if (builder.kind === 'line-insert') {
			if (!builder.line) {
				throw new Error(
					`Insert ${builder.position} in ${builder.filePath}: missing required *** Line: directive.`,
				);
			}
			if (builder.phase !== 'with') {
				throw new Error(
					`Insert ${builder.position} in ${builder.filePath}: missing required *** With: directive.`,
				);
			}
			operations.push({
				kind: 'line-insert',
				filePath: builder.filePath,
				position: builder.position,
				line: builder.line,
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
			builder = createReplaceBuilder(
				parseDirectivePath(line, PATCH_REPLACE_PREFIX),
			);
			continue;
		}

		if (line.startsWith(PATCH_DELETE_LINES_PREFIX)) {
			flushBuilder();
			builder = {
				kind: 'line-delete',
				filePath: parseDirectivePath(line, PATCH_DELETE_LINES_PREFIX),
			};
			continue;
		}

		if (line.startsWith(PATCH_REPLACE_LINES_PREFIX)) {
			flushBuilder();
			builder = {
				kind: 'line-replace',
				filePath: parseDirectivePath(line, PATCH_REPLACE_LINES_PREFIX),
				lines: [],
				phase: 'range',
			};
			continue;
		}

		if (line.startsWith(PATCH_INSERT_BEFORE_PREFIX)) {
			flushBuilder();
			builder = {
				kind: 'line-insert',
				filePath: parseDirectivePath(line, PATCH_INSERT_BEFORE_PREFIX),
				position: 'before',
				lines: [],
				phase: 'line',
			};
			continue;
		}

		if (line.startsWith(PATCH_INSERT_AFTER_PREFIX)) {
			flushBuilder();
			builder = {
				kind: 'line-insert',
				filePath: parseDirectivePath(line, PATCH_INSERT_AFTER_PREFIX),
				position: 'after',
				lines: [],
				phase: 'line',
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

		if (builder.kind === 'line-delete') {
			if (line.startsWith(PATCH_LINES_MARKER)) {
				const range = parseLineRange(line.slice(PATCH_LINES_MARKER.length));
				builder.startLine = range.startLine;
				builder.endLine = range.endLine;
				continue;
			}
			if (line.trim() !== '') {
				throw new Error(
					`Delete Lines in ${builder.filePath}: expected *** Lines: directive, got "${line}"`,
				);
			}
			continue;
		}

		if (builder.kind === 'line-replace') {
			if (builder.phase === 'with') {
				builder.lines.push(line);
				continue;
			}
			if (line.startsWith(PATCH_LINES_MARKER)) {
				const range = parseLineRange(line.slice(PATCH_LINES_MARKER.length));
				builder.startLine = range.startLine;
				builder.endLine = range.endLine;
				continue;
			}
			if (line.startsWith(PATCH_WITH_MARKER)) {
				if (!builder.startLine || !builder.endLine) {
					throw new Error(
						`Replace Lines in ${builder.filePath}: *** With: must follow *** Lines:.`,
					);
				}
				builder.phase = 'with';
				continue;
			}
			if (line.trim() === '') continue;
			throw new Error(
				`Replace Lines in ${builder.filePath}: expected *** Lines: or *** With: directive, got "${line}"`,
			);
		}

		if (builder.kind === 'line-insert') {
			if (builder.phase === 'with') {
				builder.lines.push(line);
				continue;
			}
			if (line.startsWith(PATCH_LINE_MARKER)) {
				builder.line = parsePositiveLineNumber(
					line.slice(PATCH_LINE_MARKER.length),
					'Insert line',
				);
				continue;
			}
			if (line.startsWith(PATCH_WITH_MARKER)) {
				if (!builder.line) {
					throw new Error(
						`Insert ${builder.position} in ${builder.filePath}: *** With: must follow *** Line:.`,
					);
				}
				builder.phase = 'with';
				continue;
			}
			if (line.trim() === '') continue;
			throw new Error(
				`Insert ${builder.position} in ${builder.filePath}: expected *** Line: or *** With: directive, got "${line}"`,
			);
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
