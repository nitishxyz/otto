import {
	applyIndentDelta,
	computeIndentDelta,
	detectIndentStyle,
	expandWhitespace,
	getLeadingWhitespace,
	inferTabSizeFromPairs,
} from './normalize.ts';
import type { PatchHunk } from './types.ts';

export function adjustReplacementIndentation(
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
	let hasContextContentMismatch = false;
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
				if (line.content !== fileLine) hasContextContentMismatch = true;
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

	if (
		!hasDelta &&
		!hasStyleMismatch &&
		!hasAddStyleMismatch &&
		!hasContextContentMismatch
	) {
		return hunk.lines.filter((l) => l.kind !== 'remove').map((l) => l.content);
	}

	return result;
}
