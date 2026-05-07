import { NORMALIZATION_LEVELS, normalizeWhitespace } from './normalize.ts';

export function linesMatch(
	line: string,
	pattern: string,
	useFuzzy: boolean,
): boolean {
	if (line === pattern) return true;
	if (!useFuzzy) return false;
	for (const level of NORMALIZATION_LEVELS.slice(1)) {
		if (
			normalizeWhitespace(line, level) === normalizeWhitespace(pattern, level)
		) {
			return true;
		}
	}
	return false;
}

export function findLineIndex(
	lines: string[],
	pattern: string,
	start: number,
	useFuzzy: boolean,
): number {
	for (let i = Math.max(0, start); i < lines.length; i++) {
		if (linesMatch(lines[i], pattern, useFuzzy)) return i;
	}
	return -1;
}

export function findSubsequence(
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
			if (linesMatch(lines[i + j], pattern[j], useFuzzy)) continue;
			matches = false;
			break;
		}
		if (matches) return i;
	}
	return -1;
}

export function lineExists(
	lines: string[],
	target: string,
	useFuzzy: boolean,
): boolean {
	return findLineIndex(lines, target, 0, useFuzzy) !== -1;
}
