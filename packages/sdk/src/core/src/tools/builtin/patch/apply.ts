import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import {
	NORMALIZATION_LEVELS,
	normalizeWhitespace,
	computeIndentDelta,
	applyIndentDelta,
	getLeadingWhitespace,
	detectIndentStyle,
	expandWhitespace,
	inferTabSizeFromPairs,
} from './normalize.ts';
import type {
	AppliedPatchHunk,
	AppliedPatchOperation,
	PatchAddOperation,
	PatchApplicationResult,
	PatchDeleteOperation,
	PatchHunk,
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

function findLineIndex(
	lines: string[],
	pattern: string,
	start: number,
	useFuzzy: boolean,
): number {
	for (let i = Math.max(0, start); i < lines.length; i++) {
		if (lines[i] === pattern) return i;
		if (!useFuzzy) continue;
		for (const level of NORMALIZATION_LEVELS.slice(1)) {
			if (
				normalizeWhitespace(lines[i], level) ===
				normalizeWhitespace(pattern, level)
			) {
				return i;
			}
		}
	}
	return -1;
}

function findSubsequence(
	lines: string[],
	pattern: string[],
	startIndex: number,
	useFuzzy: boolean,
): number {
	if (pattern.length === 0) return -1;
	const start = Math.max(0, startIndex);
	for (let i = start; i <= lines.length - pattern.length; i++) {
		let matches = true;
		for (let j = 0; j < pattern.length; j++) {
			const line = lines[i + j];
			const target = pattern[j];
			if (line === target) continue;
			if (!useFuzzy) {
				matches = false;
				break;
			}
			let matched = false;
			for (const level of NORMALIZATION_LEVELS.slice(1)) {
				if (
					normalizeWhitespace(line, level) ===
					normalizeWhitespace(target, level)
				) {
					matched = true;
					break;
				}
			}
			if (!matched) {
				matches = false;
				break;
			}
		}
		if (matches) return i;
	}
	return -1;
}

function computeInsertionIndex(
	lines: string[],
	header: PatchHunk['header'],
	hint: number,
): number {
	if (header.context) {
		const contextIndex = findLineIndex(lines, header.context, 0, true);
		if (contextIndex !== -1) return contextIndex + 1;
	}

	if (typeof header.oldStart === 'number') {
		const zeroBased = Math.max(0, header.oldStart - 1);
		return Math.min(lines.length, zeroBased);
	}

	if (typeof header.newStart === 'number') {
		const zeroBased = Math.max(0, header.newStart - 1);
		return Math.min(lines.length, zeroBased);
	}

	return Math.min(lines.length, Math.max(0, hint));
}

function lineExists(
	lines: string[],
	target: string,
	useFuzzy: boolean,
): boolean {
	return findLineIndex(lines, target, 0, useFuzzy) !== -1;
}

function isHunkAlreadyApplied(
	lines: string[],
	hunk: PatchHunk,
	useFuzzy: boolean,
): boolean {
	const replacement = hunk.lines
		.filter((line) => line.kind !== 'remove')
		.map((line) => line.content);

	if (replacement.length > 0) {
		return findSubsequence(lines, replacement, 0, useFuzzy) !== -1;
	}

	const removals = hunk.lines.filter((line) => line.kind === 'remove');
	const _additions = hunk.lines
		.filter((line) => line.kind === 'add')
		.map((line) => line.content);
	const _contextLines = hunk.lines
		.filter((line) => line.kind === 'context')
		.map((line) => line.content);
	if (removals.length === 0) return false;
	return removals.every((line) => !lineExists(lines, line.content, useFuzzy));
}

function adjustReplacementIndentation(
	hunk: PatchHunk,
	matchedFileLines: string[],
	allFileLines?: string[],
): string[] {
	const result: string[] = [];
	let expectedIdx = 0;
	let lastDelta = 0;
	let lastFileIndentExpanded = 0;
	let lastPatchIndentExpanded = 0;
	let hasDelta = false;
	let hasStyleMismatch = false;
	let fileIndentChar: 'tab' | 'space' = 'space';
	const deltas: number[] = [];
	let hasAddStyleMismatch = false;
	let fileIndentDetected = false;

	for (const fl of matchedFileLines) {
		const ws = getLeadingWhitespace(fl);
		if (ws.length > 0) {
			fileIndentChar = detectIndentStyle(ws);
			fileIndentDetected = true;
			break;
		}
	}

	if (!fileIndentDetected && allFileLines) {
		for (const fl of allFileLines) {
			const ws = getLeadingWhitespace(fl);
			if (ws.length > 0) {
				fileIndentChar = detectIndentStyle(ws);
				fileIndentDetected = true;
				break;
			}
		}
	}

	const patchContextLines = hunk.lines
		.filter((l) => l.kind === 'context' || l.kind === 'remove')
		.map((l) => l.content);
	const tabSize = inferTabSizeFromPairs(patchContextLines, matchedFileLines);

	let tempIdx = 0;
	for (const line of hunk.lines) {
		if (line.kind === 'context' || line.kind === 'remove') {
			const fileLine = matchedFileLines[tempIdx];
			if (fileLine !== undefined) {
				const d = computeIndentDelta(line.content, fileLine, tabSize);
				if (d !== 0) deltas.push(d);
			}
			tempIdx++;
		}
	}
	const sortedDeltas = [...deltas].sort((a, b) => a - b);
	const medianDelta =
		sortedDeltas.length > 0
			? sortedDeltas[Math.floor(sortedDeltas.length / 2)]
			: 0;

	for (const line of hunk.lines) {
		if (line.kind === 'add' && line.content.trim() !== '') {
			const ws = getLeadingWhitespace(line.content);
			if (ws.length > 0 && detectIndentStyle(ws) !== fileIndentChar) {
				hasAddStyleMismatch = true;
				break;
			}
		}
	}

	for (const line of hunk.lines) {
		if (line.kind === 'context') {
			const fileLine = matchedFileLines[expectedIdx];
			if (fileLine !== undefined) {
				lastDelta = computeIndentDelta(line.content, fileLine, tabSize);
				lastFileIndentExpanded = expandWhitespace(
					getLeadingWhitespace(fileLine),
					tabSize,
				);
				lastPatchIndentExpanded = expandWhitespace(
					getLeadingWhitespace(line.content),
					tabSize,
				);
				if (lastDelta !== 0) hasDelta = true;
				if (
					detectIndentStyle(getLeadingWhitespace(fileLine)) !==
						detectIndentStyle(getLeadingWhitespace(line.content)) &&
					getLeadingWhitespace(fileLine).length > 0
				) {
					hasStyleMismatch = true;
				}
				result.push(fileLine);
			} else {
				result.push(line.content);
			}
			expectedIdx++;
		} else if (line.kind === 'remove') {
			const fileLine = matchedFileLines[expectedIdx];
			if (fileLine !== undefined) {
				lastDelta = computeIndentDelta(line.content, fileLine, tabSize);
				lastFileIndentExpanded = expandWhitespace(
					getLeadingWhitespace(fileLine),
					tabSize,
				);
				lastPatchIndentExpanded = expandWhitespace(
					getLeadingWhitespace(line.content),
					tabSize,
				);
				if (lastDelta !== 0) hasDelta = true;
				if (
					detectIndentStyle(getLeadingWhitespace(fileLine)) !==
						detectIndentStyle(getLeadingWhitespace(line.content)) &&
					getLeadingWhitespace(fileLine).length > 0
				) {
					hasStyleMismatch = true;
				}
			}
			expectedIdx++;
		} else if (line.kind === 'add') {
			const addIndent = expandWhitespace(
				getLeadingWhitespace(line.content),
				tabSize,
			);
			const addWs = getLeadingWhitespace(line.content);
			const addStyle =
				addWs.length > 0 ? detectIndentStyle(addWs) : fileIndentChar;
			const styleMismatch =
				addStyle !== fileIndentChar && line.content.trim() !== '';
			if (styleMismatch) {
				const relativeOffset = addIndent - lastPatchIndentExpanded;
				const targetIndent = lastFileIndentExpanded + relativeOffset;
				const actualDelta = targetIndent - addIndent;
				result.push(
					applyIndentDelta(line.content, actualDelta, fileIndentChar, tabSize),
				);
			} else if (Math.abs(medianDelta) > tabSize) {
				result.push(
					applyIndentDelta(line.content, medianDelta, fileIndentChar, tabSize),
				);
			} else {
				result.push(line.content);
			}
		}
	}

	if (!hasDelta && !hasStyleMismatch && !hasAddStyleMismatch) {
		return hunk.lines.filter((l) => l.kind !== 'remove').map((l) => l.content);
	}

	return result;
}

function applyHunkToLines(
	lines: string[],
	originalLines: string[],
	hunk: PatchHunk,
	hint: number,
	useFuzzy: boolean,
): AppliedPatchHunk | null {
	const expected = hunk.lines
		.filter((line) => line.kind !== 'add')
		.map((line) => line.content);
	const replacement = hunk.lines
		.filter((line) => line.kind !== 'remove')
		.map((line) => line.content);

	const removals = hunk.lines.filter((line) => line.kind === 'remove');
	const additions = hunk.lines
		.filter((line) => line.kind === 'add')
		.map((line) => line.content);
	const contextLines = hunk.lines
		.filter((line) => line.kind === 'context')
		.map((line) => line.content);

	const hasExpected = expected.length > 0;
	const initialHint =
		typeof hunk.header.oldStart === 'number'
			? Math.max(0, hunk.header.oldStart - 1)
			: hint;

	let matchIndex = hasExpected
		? findSubsequence(lines, expected, Math.max(0, initialHint - 3), useFuzzy)
		: -1;
	let matchedExpected = expected;

	if (hasExpected && matchIndex === -1) {
		matchIndex = findSubsequence(lines, expected, 0, useFuzzy);
	}

	if (matchIndex === -1 && removals.length > 0) {
		const allContextPresent = contextLines.every((line) =>
			lineExists(lines, line, useFuzzy),
		);
		if (!allContextPresent) {
			matchIndex = -1;
		} else {
			const expectedWithoutMissingRemovals = hunk.lines
				.filter((line) => {
					if (line.kind === 'add') return false;
					if (line.kind === 'remove') {
						return lineExists(lines, line.content, useFuzzy);
					}
					return true;
				})
				.map((line) => line.content);
			const includedRemovalCount = hunk.lines.filter(
				(line) =>
					line.kind === 'remove' && lineExists(lines, line.content, useFuzzy),
			).length;
			const minRequired = Math.max(contextLines.length, 2);
			if (
				includedRemovalCount > 0 &&
				expectedWithoutMissingRemovals.length >= minRequired
			) {
				matchIndex = findSubsequence(
					lines,
					expectedWithoutMissingRemovals,
					Math.max(0, initialHint - 3),
					useFuzzy,
				);
				if (matchIndex === -1) {
					matchIndex = findSubsequence(
						lines,
						expectedWithoutMissingRemovals,
						0,
						useFuzzy,
					);
				}
				if (matchIndex !== -1) {
					matchedExpected = expectedWithoutMissingRemovals;
				}
			}
		}
	}

	if (
		matchIndex === -1 &&
		useFuzzy &&
		removals.length >= 2 &&
		contextLines.length === 0
	) {
		const firstRemoval = removals[0].content;
		const lastRemoval = removals[removals.length - 1].content;
		const firstIdx = findLineIndex(lines, firstRemoval, 0, true);
		if (firstIdx !== -1) {
			const rangeEnd = firstIdx + expected.length - 1;
			if (rangeEnd < lines.length) {
				const lastInRange = lines[rangeEnd];
				let lastMatches = lastInRange === lastRemoval;
				if (!lastMatches) {
					for (const level of NORMALIZATION_LEVELS.slice(1)) {
						if (
							normalizeWhitespace(lastInRange, level) ===
							normalizeWhitespace(lastRemoval, level)
						) {
							lastMatches = true;
							break;
						}
					}
				}
				if (lastMatches) {
					let matchCount = 0;
					for (let k = 0; k < expected.length; k++) {
						const fileLine = lines[firstIdx + k];
						const expLine = expected[k];
						if (fileLine === expLine) {
							matchCount++;
							continue;
						}
						for (const level of NORMALIZATION_LEVELS.slice(1)) {
							if (
								normalizeWhitespace(fileLine, level) ===
								normalizeWhitespace(expLine, level)
							) {
								matchCount++;
								break;
							}
						}
					}
					const matchRatio = matchCount / expected.length;
					if (matchRatio >= 0.5) {
						matchIndex = firstIdx;
						matchedExpected = lines.slice(firstIdx, firstIdx + expected.length);
					}
				}
			}
		}
	}

	if (matchIndex === -1 && isHunkAlreadyApplied(lines, hunk, useFuzzy)) {
		const skipStart =
			initialHint >= 0 && initialHint < lines.length ? initialHint + 1 : 1;
		return {
			header: { ...hunk.header },
			lines: hunk.lines.map((line) => ({ ...line })),
			oldStart: skipStart,
			oldLines: 0,
			newStart: skipStart,
			newLines: replacement.length,
			additions: hunk.lines.filter((l) => l.kind === 'add').length,
			deletions: hunk.lines.filter((l) => l.kind === 'remove').length,
		};
	}

	if (matchIndex === -1 && !hasExpected) {
		matchIndex = computeInsertionIndex(lines, hunk.header, initialHint);
	}

	if (matchIndex === -1) {
		const contextInfo = hunk.header.context
			? ` near context '${hunk.header.context}'`
			: '';

		if (additions.length > 0) {
			const hasRemovals = removals.length > 0;
			let anchorIndex = -1;
			if (!hasRemovals && contextLines.length > 0) {
				const anchorContext = contextLines[contextLines.length - 1];
				anchorIndex = findLineIndex(lines, anchorContext, 0, useFuzzy);
			} else if (!hasRemovals) {
				anchorIndex = -1;
			}

			const insertionIndex =
				anchorIndex !== -1
					? anchorIndex + 1
					: computeInsertionIndex(lines, hunk.header, initialHint);

			if (
				findSubsequence(
					lines,
					additions,
					Math.max(0, insertionIndex - additions.length),
					useFuzzy,
				) !== -1
			) {
				const skipStart =
					insertionIndex >= 0 && insertionIndex < lines.length
						? insertionIndex + 1
						: lines.length + 1;
				return {
					header: { ...hunk.header },
					lines: hunk.lines.map((line) => ({ ...line })),
					oldStart: skipStart,
					oldLines: 0,
					newStart: skipStart,
					newLines: additions.length,
					additions: additions.length,
					deletions: 0,
				};
			}
		}

		let errorMsg = `Failed to apply patch hunk${contextInfo}.`;
		if (expected.length > 0) {
			errorMsg += `\nExpected to find:\n${expected
				.map((l) => `  ${l}`)
				.join('\n')}`;
		}
		if (removals.length > 0) {
			const missing = removals
				.filter((line) => !lineExists(lines, line.content, useFuzzy))
				.map((line) => line.content);
			if (missing.length === removals.length) {
				errorMsg +=
					'\nAll removal lines already absent; consider reading the file again to capture current state.';
			}
		}
		throw new Error(errorMsg);
	}

	const deleteCount = hasExpected ? matchedExpected.length : 0;
	const originalIndex = matchIndex;
	const oldStart = Math.min(
		originalLines.length,
		Math.max(0, originalIndex) + 1,
	);
	const newStart = matchIndex + 1;

	const adjustedReplacement =
		useFuzzy && hasExpected && matchedExpected.length === expected.length
			? adjustReplacementIndentation(
					hunk,
					lines.slice(matchIndex, matchIndex + matchedExpected.length),
					originalLines,
				)
			: replacement;

	const targetSlice = lines.slice(
		matchIndex,
		matchIndex + adjustedReplacement.length,
	);
	if (
		adjustedReplacement.length > 0 &&
		adjustedReplacement.length === targetSlice.length &&
		adjustedReplacement.every((line, i) => {
			if (line === targetSlice[i]) return true;
			if (!useFuzzy) return false;
			for (const level of NORMALIZATION_LEVELS.slice(1)) {
				if (
					normalizeWhitespace(line, level) ===
					normalizeWhitespace(targetSlice[i], level)
				) {
					return true;
				}
			}
			return false;
		})
	) {
		const skipStart = matchIndex + 1;
		return {
			header: { ...hunk.header },
			lines: hunk.lines.map((line) => ({ ...line })),
			oldStart: skipStart,
			oldLines: 0,
			newStart: skipStart,
			newLines: adjustedReplacement.length,
			additions: 0,
			deletions: 0,
		};
	}

	lines.splice(matchIndex, deleteCount, ...adjustedReplacement);

	return {
		header: { ...hunk.header },
		lines: hunk.lines.map((line) => ({ ...line })),
		oldStart,
		oldLines: deleteCount,
		newStart,
		newLines: adjustedReplacement.length,
		additions: hunk.lines.filter((l) => l.kind === 'add').length,
		deletions: hunk.lines.filter((l) => l.kind === 'remove').length,
	};
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
