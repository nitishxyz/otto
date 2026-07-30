import { adjustReplacementIndentation } from './indentation.ts';
import {
	findLineIndex,
	findSubsequence,
	lineExists,
	linesMatch,
} from './matching.ts';
import type { AppliedPatchHunk, PatchHunk } from './types.ts';

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

const CLOSEST_MATCH_MIN_RATIO = 0.3;
const CLOSEST_MATCH_MAX_FILE_LINES = 20000;
const ERROR_EXCERPT_MAX_LINES = 30;

/**
 * Locate the file region most similar to the expected block so failure
 * messages show what the file actually contains near the intended edit.
 */
function describeClosestMatch(
	lines: string[],
	expected: string[],
): string | null {
	if (expected.length === 0 || lines.length === 0) return null;
	if (lines.length > CLOSEST_MATCH_MAX_FILE_LINES) return null;
	const windowSize = Math.min(expected.length, lines.length);
	let bestIndex = -1;
	let bestScore = 0;
	for (let i = 0; i + windowSize <= lines.length; i++) {
		let score = 0;
		for (let j = 0; j < windowSize; j++) {
			if (linesMatch(lines[i + j], expected[j], true)) score++;
		}
		if (score > bestScore) {
			bestScore = score;
			bestIndex = i;
		}
	}
	if (
		bestIndex === -1 ||
		bestScore / expected.length < CLOSEST_MATCH_MIN_RATIO
	) {
		return null;
	}
	const end = Math.min(
		lines.length,
		bestIndex + Math.min(windowSize, ERROR_EXCERPT_MAX_LINES),
	);
	const excerpt = lines
		.slice(bestIndex, end)
		.map((content, offset) => `  ${bestIndex + offset + 1}| ${content}`)
		.join('\n');
	return `Closest match in file (lines ${bestIndex + 1}-${end}):\n${excerpt}`;
}

export function applyHunkToLines(
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
				const lastMatches = linesMatch(lastInRange, lastRemoval, true);
				if (lastMatches) {
					let matchCount = 0;
					for (let k = 0; k < expected.length; k++) {
						const fileLine = lines[firstIdx + k];
						const expLine = expected[k];
						if (linesMatch(fileLine, expLine, true)) {
							matchCount++;
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
			const shown = expected.slice(0, ERROR_EXCERPT_MAX_LINES);
			errorMsg += `\nExpected to find:\n${shown
				.map((l) => `  ${l}`)
				.join('\n')}`;
			if (expected.length > shown.length) {
				errorMsg += `\n  ... (${expected.length - shown.length} more lines)`;
			}
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
		const closest = describeClosestMatch(lines, expected);
		if (closest) {
			errorMsg += `\n${closest}`;
		}
		errorMsg +=
			'\nTip: reread the file and rebuild this hunk from current content, or use *** Replace Lines in: <path> with *** Lines: <start>-<end> and *** With: from a fresh read.';
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
			return linesMatch(line, targetSlice[i], useFuzzy);
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
