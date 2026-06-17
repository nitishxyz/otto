import { adjustReplacementIndentation } from '../patch/indentation.ts';
import { linesMatch } from '../patch/matching.ts';

export function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, '\n');
}

export function detectLineEnding(text: string): '\n' | '\r\n' {
	return text.includes('\r\n') ? '\r\n' : '\n';
}

export function convertToLineEnding(
	text: string,
	lineEnding: '\n' | '\r\n',
): string {
	if (lineEnding === '\n') return text;
	return text.replace(/\n/g, '\r\n');
}

function countOccurrences(content: string, search: string): number {
	if (!search) return 0;
	let count = 0;
	let start = 0;
	while (true) {
		const index = content.indexOf(search, start);
		if (index === -1) return count;
		count += 1;
		start = index + search.length;
	}
}

function splitEditableLines(
	text: string,
	lineEnding: '\n' | '\r\n',
	keepTrailingEmpty = false,
): { lines: string[]; hasTrailingNewline: boolean } {
	const lines = text.split(lineEnding);
	const hasTrailingNewline = lines.length > 1 && lines[lines.length - 1] === '';
	if (hasTrailingNewline && !keepTrailingEmpty) {
		lines.pop();
	}
	return { lines, hasTrailingNewline };
}

function joinEditableLines(
	lines: string[],
	lineEnding: '\n' | '\r\n',
	hasTrailingNewline: boolean,
): string {
	const content = lines.join(lineEnding);
	return hasTrailingNewline && lines[lines.length - 1] !== ''
		? `${content}${lineEnding}`
		: content;
}

function findFuzzyLineOccurrences(
	contentLines: string[],
	oldLines: string[],
): number[] {
	if (oldLines.length === 0) return [];
	const occurrences: number[] = [];
	for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
		let matches = true;
		for (let j = 0; j < oldLines.length; j++) {
			if (linesMatch(contentLines[i + j], oldLines[j], true)) continue;
			matches = false;
			break;
		}
		if (matches) occurrences.push(i);
	}
	return occurrences;
}

function adjustFuzzyReplacement(
	oldLines: string[],
	newLines: string[],
	matchedFileLines: string[],
): string[] {
	return adjustReplacementIndentation(
		{
			header: {},
			lines: [
				...oldLines.map((line) => ({ kind: 'remove' as const, content: line })),
				...newLines.map((line) => ({ kind: 'add' as const, content: line })),
			],
		},
		matchedFileLines,
	);
}

function applyFuzzyLineEdit(
	content: string,
	oldString: string,
	newString: string,
	lineEnding: '\n' | '\r\n',
	replaceAll: boolean,
): { content: string; occurrences: number } | null {
	const { lines: contentLines, hasTrailingNewline } = splitEditableLines(
		content,
		lineEnding,
	);
	const { lines: oldLines } = splitEditableLines(oldString, lineEnding);
	const { lines: newLines } = splitEditableLines(newString, lineEnding, true);
	const occurrences = findFuzzyLineOccurrences(contentLines, oldLines);
	if (occurrences.length === 0) return null;
	if (occurrences.length > 1 && !replaceAll) {
		throw new Error(
			'Found multiple fuzzy matches for oldString after whitespace normalization. Provide more surrounding lines to make it unique or set replaceAll to true.',
		);
	}

	const nextLines = [...contentLines];
	const targets = replaceAll ? occurrences : occurrences.slice(0, 1);
	for (const start of [...targets].reverse()) {
		const matchedFileLines = nextLines.slice(start, start + oldLines.length);
		const adjustedNewLines = adjustFuzzyReplacement(
			oldLines,
			newLines,
			matchedFileLines,
		);
		nextLines.splice(start, oldLines.length, ...adjustedNewLines);
	}

	return {
		content: joinEditableLines(nextLines, lineEnding, hasTrailingNewline),
		occurrences: occurrences.length,
	};
}

export function applyStringEdit(
	content: string,
	oldString: string,
	newString: string,
	replaceAll = false,
): { content: string; occurrences: number } {
	if (oldString.length === 0) {
		throw new Error(
			'oldString must not be empty. Use write to create files or a structural editing tool for larger insertions.',
		);
	}
	if (oldString === newString) {
		throw new Error(
			'No changes to apply: oldString and newString are identical.',
		);
	}

	const lineEnding = detectLineEnding(content);
	const normalizedOld = convertToLineEnding(
		normalizeLineEndings(oldString),
		lineEnding,
	);
	const normalizedNew = convertToLineEnding(
		normalizeLineEndings(newString),
		lineEnding,
	);

	const occurrences = countOccurrences(content, normalizedOld);
	if (occurrences === 0) {
		const fuzzyResult = applyFuzzyLineEdit(
			content,
			normalizedOld,
			normalizedNew,
			lineEnding,
			replaceAll,
		);
		if (fuzzyResult) return fuzzyResult;
		throw new Error(
			'oldString not found in content. Read the file again and copy the exact text. Whitespace-only differences are tolerated when the oldString matches whole lines uniquely.',
		);
	}
	if (occurrences > 1 && !replaceAll) {
		throw new Error(
			'Found multiple matches for oldString. Provide more surrounding lines to make it unique or set replaceAll to true.',
		);
	}

	if (replaceAll) {
		return {
			content: content.split(normalizedOld).join(normalizedNew),
			occurrences,
		};
	}

	const index = content.indexOf(normalizedOld);
	return {
		content:
			content.slice(0, index) +
			normalizedNew +
			content.slice(index + normalizedOld.length),
		occurrences,
	};
}
