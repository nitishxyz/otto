enum NormalizationLevel {
	EXACT = 'exact',
	TABS_ONLY = 'tabs',
	WHITESPACE = 'whitespace',
	AGGRESSIVE = 'aggressive',
	COLLAPSED = 'collapsed',
}

const DEFAULT_TAB_SIZE = 2;

export function normalizeWhitespace(
	line: string,
	level: NormalizationLevel,
	tabSize: number = DEFAULT_TAB_SIZE,
): string {
	const tabReplacement = ' '.repeat(tabSize);
	switch (level) {
		case NormalizationLevel.EXACT:
			return line;
		case NormalizationLevel.TABS_ONLY:
			return line.replace(/\t/g, tabReplacement);
		case NormalizationLevel.WHITESPACE:
			return line.replace(/\t/g, tabReplacement).replace(/\s+$/, '');
		case NormalizationLevel.AGGRESSIVE:
			return line.replace(/\t/g, tabReplacement).trim();
		case NormalizationLevel.COLLAPSED:
			return line.replace(/\t/g, tabReplacement).trim().replace(/\s+/g, ' ');
		default:
			return line;
	}
}

export const NORMALIZATION_LEVELS: NormalizationLevel[] = [
	NormalizationLevel.EXACT,
	NormalizationLevel.TABS_ONLY,
	NormalizationLevel.WHITESPACE,
	NormalizationLevel.AGGRESSIVE,
	NormalizationLevel.COLLAPSED,
];

export function getLeadingWhitespace(line: string): string {
	const match = line.match(/^(\s*)/);
	return match ? match[1] : '';
}

export function detectIndentStyle(ws: string): 'tab' | 'space' {
	return ws.includes('\t') ? 'tab' : 'space';
}

export function expandWhitespace(
	ws: string,
	tabSize: number = DEFAULT_TAB_SIZE,
): number {
	let col = 0;
	for (const ch of ws) {
		if (ch === '\t') {
			col += tabSize;
		} else {
			col++;
		}
	}
	return col;
}

export function computeIndentDelta(
	modelLine: string,
	fileLine: string,
	tabSize: number = DEFAULT_TAB_SIZE,
): number {
	const modelWs = getLeadingWhitespace(modelLine);
	const fileWs = getLeadingWhitespace(fileLine);
	return expandWhitespace(fileWs, tabSize) - expandWhitespace(modelWs, tabSize);
}

export function applyIndentDelta(
	line: string,
	delta: number,
	fileIndentChar?: 'tab' | 'space',
	tabSize: number = DEFAULT_TAB_SIZE,
): string {
	if (line.trim() === '') return line;
	const ws = getLeadingWhitespace(line);
	if (
		delta === 0 &&
		(!fileIndentChar || detectIndentStyle(ws) === fileIndentChar)
	) {
		return line;
	}
	const currentExpanded = expandWhitespace(ws, tabSize);
	const targetExpanded = Math.max(0, currentExpanded + delta);

	if (fileIndentChar === 'tab') {
		const tabs = Math.floor(targetExpanded / tabSize);
		const spaces = targetExpanded % tabSize;
		return '\t'.repeat(tabs) + ' '.repeat(spaces) + line.slice(ws.length);
	}
	return ' '.repeat(targetExpanded) + line.slice(ws.length);
}

export function reindentLine(
	line: string,
	fileIndentChar: 'tab' | 'space',
	targetExpandedWidth: number,
	tabSize: number = DEFAULT_TAB_SIZE,
): string {
	const ws = getLeadingWhitespace(line);
	if (fileIndentChar === 'tab') {
		const tabs = Math.floor(targetExpandedWidth / tabSize);
		const spaces = targetExpandedWidth % tabSize;
		return '\t'.repeat(tabs) + ' '.repeat(spaces) + line.slice(ws.length);
	}
	return ' '.repeat(targetExpandedWidth) + line.slice(ws.length);
}

function gcd(a: number, b: number): number {
	while (b) {
		[a, b] = [b, a % b];
	}
	return a;
}

export function inferTabSizeFromPairs(
	patchLines: string[],
	fileLines: string[],
): number {
	const samples: number[] = [];
	const len = Math.min(patchLines.length, fileLines.length);

	for (let i = 0; i < len; i++) {
		const patchWs = getLeadingWhitespace(patchLines[i]);
		const fileWs = getLeadingWhitespace(fileLines[i]);
		if (!patchWs && !fileWs) continue;

		const patchHasTabs = patchWs.includes('\t');
		const fileHasTabs = fileWs.includes('\t');

		if (fileHasTabs && !patchHasTabs && patchWs.length > 0) {
			const tabCount = fileWs.split('').filter((c) => c === '\t').length;
			const extraSpaces = fileWs.split('').filter((c) => c !== '\t').length;
			if (tabCount > 0) {
				const spaceEquiv = patchWs.length - extraSpaces;
				if (spaceEquiv > 0) {
					samples.push(Math.round(spaceEquiv / tabCount));
				}
			}
		} else if (patchHasTabs && !fileHasTabs && fileWs.length > 0) {
			const tabCount = patchWs.split('').filter((c) => c === '\t').length;
			const extraSpaces = patchWs.split('').filter((c) => c !== '\t').length;
			if (tabCount > 0) {
				const spaceEquiv = fileWs.length - extraSpaces;
				if (spaceEquiv > 0) {
					samples.push(Math.round(spaceEquiv / tabCount));
				}
			}
		}
	}

	if (samples.length === 0) return DEFAULT_TAB_SIZE;

	const counts = new Map<number, number>();
	for (const s of samples) {
		counts.set(s, (counts.get(s) ?? 0) + 1);
	}
	let bestSize = DEFAULT_TAB_SIZE;
	let bestCount = 0;
	for (const [size, count] of counts) {
		if (count > bestCount || (count === bestCount && size > bestSize)) {
			bestSize = size;
			bestCount = count;
		}
	}

	return bestSize;
}

export function inferTabSizeFromFileLines(lines: string[]): number {
	const indents: number[] = [];
	for (const line of lines) {
		if (line.trim() === '') continue;
		const ws = getLeadingWhitespace(line);
		if (ws.length === 0) continue;
		if (ws.includes('\t')) return DEFAULT_TAB_SIZE;
		indents.push(ws.length);
	}

	if (indents.length === 0) return DEFAULT_TAB_SIZE;

	const diffs = new Set<number>();
	const sorted = [...new Set(indents)].sort((a, b) => a - b);
	for (let i = 1; i < sorted.length; i++) {
		const d = sorted[i] - sorted[i - 1];
		if (d > 0) diffs.add(d);
	}
	if (sorted[0] > 0) diffs.add(sorted[0]);

	if (diffs.size === 0) return DEFAULT_TAB_SIZE;

	let result = 0;
	for (const d of diffs) {
		result = result === 0 ? d : gcd(result, d);
	}

	if (result <= 0 || result > 8) return DEFAULT_TAB_SIZE;
	return result;
}
