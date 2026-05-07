import type {
	PatchHunk,
	PatchHunkLine,
	PatchUpdateOperation,
} from './types.ts';

export interface ReplaceBuilder {
	kind: 'replace';
	filePath: string;
	hunks: PatchHunk[];
	phase: 'idle' | 'find' | 'with';
	findLines: string[];
	withLines: string[];
}

export function createReplaceBuilder(filePath: string): ReplaceBuilder {
	return {
		kind: 'replace',
		filePath,
		hunks: [],
		phase: 'idle',
		findLines: [],
		withLines: [],
	};
}

export function flushReplacePair(builder: ReplaceBuilder) {
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

export function flushReplaceBuilder(
	builder: ReplaceBuilder,
): PatchUpdateOperation {
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
