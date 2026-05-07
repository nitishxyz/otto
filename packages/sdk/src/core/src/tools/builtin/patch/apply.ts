import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { applyHunkToLines } from './apply-hunk.ts';
import type {
	AppliedPatchHunk,
	AppliedPatchOperation,
	PatchAddOperation,
	PatchApplicationResult,
	PatchDeleteOperation,
	PatchOperation,
	PatchUpdateOperation,
	RejectedPatch,
} from './types.ts';
import { ensureTrailingNewline, joinLines, splitLines } from './text.ts';
import {
	formatNormalizedPatch,
	makeAppliedRecord,
	makeSummary,
} from './apply-report.ts';

export function resolveProjectPath(
	projectRoot: string,
	filePath: string,
): string {
	const fullPath = resolve(projectRoot, filePath);
	const relativePath = relative(projectRoot, fullPath);
	if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
		throw new Error(`Patch path escapes project root: ${filePath}`);
	}
	return fullPath;
}

async function applyAddOperation(
	projectRoot: string,
	operation: PatchAddOperation,
): Promise<AppliedPatchOperation> {
	const target = resolveProjectPath(projectRoot, operation.filePath);
	await mkdir(dirname(target), { recursive: true });
	const lines = [...operation.lines];
	ensureTrailingNewline(lines);
	await writeFile(target, joinLines(lines, '\n'), 'utf-8');

	const appliedHunk: AppliedPatchHunk = {
		header: {},
		lines: operation.lines.map((line) => ({ kind: 'add', content: line })),
		oldStart: 0,
		oldLines: 0,
		newStart: 1,
		newLines: operation.lines.length,
		additions: operation.lines.length,
		deletions: 0,
	};

	return makeAppliedRecord('add', operation.filePath, [appliedHunk]);
}

async function applyDeleteOperation(
	projectRoot: string,
	operation: PatchDeleteOperation,
): Promise<AppliedPatchOperation> {
	const target = resolveProjectPath(projectRoot, operation.filePath);
	let existing = '';
	try {
		existing = await readFile(target, 'utf-8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(`File not found for deletion: ${operation.filePath}`);
		}
		throw error;
	}

	const { lines } = splitLines(existing);
	await unlink(target);

	const appliedHunk: AppliedPatchHunk = {
		header: {},
		lines: lines.map((line) => ({ kind: 'remove', content: line })),
		oldStart: 1,
		oldLines: lines.length,
		newStart: 0,
		newLines: 0,
		additions: 0,
		deletions: lines.length,
	};

	return makeAppliedRecord('delete', operation.filePath, [appliedHunk]);
}

async function applyUpdateOperation(
	projectRoot: string,
	operation: PatchUpdateOperation,
	useFuzzy: boolean,
	allowRejects: boolean = false,
): Promise<AppliedPatchOperation> {
	const target = resolveProjectPath(projectRoot, operation.filePath);
	let original: string;
	try {
		original = await readFile(target, 'utf-8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(`File not found: ${operation.filePath}`);
		}
		throw error;
	}

	const { lines: originalLines, newline } = splitLines(original);
	const workingLines = [...originalLines];
	const appliedHunks: AppliedPatchHunk[] = [];
	let failedHunkCount = 0;
	let hint = 0;

	for (const hunk of operation.hunks) {
		try {
			const applied = applyHunkToLines(
				workingLines,
				originalLines,
				hunk,
				hint,
				useFuzzy,
			);
			if (!applied) continue;
			appliedHunks.push(applied);
			hint = applied.newStart + applied.newLines - 1;
		} catch (error) {
			if (!allowRejects) throw error;
			failedHunkCount++;
		}
	}

	if (failedHunkCount > 0 && appliedHunks.length === 0) {
		throw new Error(
			`All ${failedHunkCount} hunk(s) failed for ${operation.filePath}`,
		);
	}

	if (failedHunkCount > 0) {
		workingLines.length = 0;
		workingLines.push(...originalLines);
		appliedHunks.length = 0;
		hint = 0;
		for (const hunk of operation.hunks) {
			try {
				const applied = applyHunkToLines(
					workingLines,
					originalLines,
					hunk,
					hint,
					useFuzzy,
				);
				if (!applied) continue;
				appliedHunks.push(applied);
				hint = applied.newStart + applied.newLines - 1;
			} catch {}
		}
	}

	ensureTrailingNewline(workingLines);
	await writeFile(target, joinLines(workingLines, newline), 'utf-8');

	return makeAppliedRecord('update', operation.filePath, appliedHunks);
}

export async function applyPatchOperations(
	projectRoot: string,
	operations: PatchOperation[],
	options: { useFuzzy: boolean; allowRejects: boolean },
): Promise<PatchApplicationResult> {
	const applied: AppliedPatchOperation[] = [];
	const rejected: RejectedPatch[] = [];

	for (const operation of operations) {
		try {
			if (operation.kind === 'add') {
				applied.push(await applyAddOperation(projectRoot, operation));
			} else if (operation.kind === 'delete') {
				applied.push(await applyDeleteOperation(projectRoot, operation));
			} else {
				applied.push(
					await applyUpdateOperation(
						projectRoot,
						operation,
						options.useFuzzy,
						options.allowRejects,
					),
				);
			}
		} catch (error) {
			if (options.allowRejects) {
				rejected.push({
					kind: operation.kind,
					filePath: operation.filePath,
					reason: error instanceof Error ? error.message : String(error),
					operation,
				});
				continue;
			}
			throw error;
		}
	}

	const summary = makeSummary(applied);

	return {
		operations: applied,
		summary,
		normalizedPatch: formatNormalizedPatch(applied),
		rejected,
	};
}
