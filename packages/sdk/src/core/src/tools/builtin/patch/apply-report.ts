import {
	PATCH_ADD_PREFIX,
	PATCH_BEGIN_MARKER,
	PATCH_DELETE_PREFIX,
	PATCH_END_MARKER,
	PATCH_UPDATE_PREFIX,
} from './constants.ts';
import type {
	AppliedPatchHunk,
	AppliedPatchOperation,
	PatchHunkLine,
	PatchSummary,
} from './types.ts';

export function makeAppliedRecord(
	kind: AppliedPatchOperation['kind'],
	filePath: string,
	hunks: AppliedPatchHunk[],
): AppliedPatchOperation {
	const stats = hunks.reduce(
		(acc, hunk) => ({
			additions: acc.additions + hunk.additions,
			deletions: acc.deletions + hunk.deletions,
		}),
		{ additions: 0, deletions: 0 },
	);
	return {
		kind,
		filePath,
		stats,
		hunks,
	};
}

export function makeSummary(operations: AppliedPatchOperation[]): PatchSummary {
	return operations.reduce<PatchSummary>(
		(acc, op) => ({
			files: acc.files + 1,
			additions: acc.additions + op.stats.additions,
			deletions: acc.deletions + op.stats.deletions,
		}),
		{ files: 0, additions: 0, deletions: 0 },
	);
}

export function formatNormalizedPatch(
	operations: AppliedPatchOperation[],
): string {
	const lines: string[] = [PATCH_BEGIN_MARKER];
	for (const op of operations) {
		switch (op.kind) {
			case 'add':
				lines.push(`${PATCH_ADD_PREFIX} ${op.filePath}`);
				break;
			case 'delete':
				lines.push(`${PATCH_DELETE_PREFIX} ${op.filePath}`);
				break;
			case 'update':
				lines.push(`${PATCH_UPDATE_PREFIX} ${op.filePath}`);
				break;
		}

		for (const hunk of op.hunks) {
			lines.push(formatHunkHeader(hunk));
			for (const line of hunk.lines) {
				lines.push(serializePatchLine(line));
			}
		}
	}
	lines.push(PATCH_END_MARKER);
	return lines.join('\n');
}

function serializePatchLine(line: PatchHunkLine): string {
	switch (line.kind) {
		case 'add':
			return `+${line.content}`;
		case 'remove':
			return `-${line.content}`;
		default:
			return ` ${line.content}`;
	}
}

function formatRange(start: number, count: number) {
	const normalizedStart = Math.max(0, start);
	if (count === 0) return `${normalizedStart},0`;
	if (count === 1) return `${normalizedStart}`;
	return `${normalizedStart},${count}`;
}

function formatHunkHeader(hunk: AppliedPatchHunk) {
	const oldRange = formatRange(hunk.oldStart, hunk.oldLines);
	const newRange = formatRange(hunk.newStart, hunk.newLines);
	const context = hunk.header.context?.trim();
	return context
		? `@@ -${oldRange} +${newRange} @@ ${context}`
		: `@@ -${oldRange} +${newRange} @@`;
}
