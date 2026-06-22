export type SyntheticDiffLineTone = 'add' | 'remove';

export interface SyntheticDiffDocument {
	content: string;
	lineTones: Map<number, SyntheticDiffLineTone>;
	firstLine?: number;
	latestLine?: number;
}

interface DiffLineRecord {
	text: string;
	tone?: SyntheticDiffLineTone;
}

function splitLines(content: string): string[] {
	return content.split('\n');
}

function sharedPrefixLength(left: string[], right: string[]): number {
	const max = Math.min(left.length, right.length);
	let index = 0;
	while (index < max && left[index] === right[index]) index += 1;
	return index;
}

function sharedSuffixLength(
	left: string[],
	right: string[],
	prefixLength: number,
): number {
	const max = Math.min(left.length, right.length) - prefixLength;
	let offset = 0;
	while (
		offset < max &&
		left[left.length - 1 - offset] === right[right.length - 1 - offset]
	) {
		offset += 1;
	}
	return offset;
}

function buildMiddleDiffRecords(
	baselineLines: string[],
	latestLines: string[],
): DiffLineRecord[] {
	if (baselineLines.length === 0) {
		return latestLines.map((text) => ({ text, tone: 'add' }));
	}
	if (latestLines.length === 0) {
		return baselineLines.map((text) => ({ text, tone: 'remove' }));
	}

	const rows = baselineLines.length + 1;
	const columns = latestLines.length + 1;
	const lengths = Array.from({ length: rows }, () =>
		Array<number>(columns).fill(0),
	);
	for (
		let leftIndex = baselineLines.length - 1;
		leftIndex >= 0;
		leftIndex -= 1
	) {
		for (
			let rightIndex = latestLines.length - 1;
			rightIndex >= 0;
			rightIndex -= 1
		) {
			lengths[leftIndex][rightIndex] =
				baselineLines[leftIndex] === latestLines[rightIndex]
					? lengths[leftIndex + 1][rightIndex + 1] + 1
					: Math.max(
							lengths[leftIndex + 1][rightIndex],
							lengths[leftIndex][rightIndex + 1],
						);
		}
	}

	const records: DiffLineRecord[] = [];
	let leftIndex = 0;
	let rightIndex = 0;
	while (leftIndex < baselineLines.length && rightIndex < latestLines.length) {
		if (baselineLines[leftIndex] === latestLines[rightIndex]) {
			records.push({ text: baselineLines[leftIndex] });
			leftIndex += 1;
			rightIndex += 1;
			continue;
		}
		if (
			lengths[leftIndex + 1][rightIndex] >= lengths[leftIndex][rightIndex + 1]
		) {
			records.push({ text: baselineLines[leftIndex], tone: 'remove' });
			leftIndex += 1;
			continue;
		}
		records.push({ text: latestLines[rightIndex], tone: 'add' });
		rightIndex += 1;
	}
	while (leftIndex < baselineLines.length) {
		records.push({ text: baselineLines[leftIndex], tone: 'remove' });
		leftIndex += 1;
	}
	while (rightIndex < latestLines.length) {
		records.push({ text: latestLines[rightIndex], tone: 'add' });
		rightIndex += 1;
	}
	return records;
}

export function buildSyntheticDiffDocument(
	baselineContent: string,
	latestContent: string,
): SyntheticDiffDocument | null {
	if (baselineContent === latestContent) return null;

	const baselineLines = splitLines(baselineContent);
	const latestLines = splitLines(latestContent);
	const prefixLength = sharedPrefixLength(baselineLines, latestLines);
	const suffixLength = sharedSuffixLength(
		baselineLines,
		latestLines,
		prefixLength,
	);
	const records: DiffLineRecord[] = [
		...baselineLines.slice(0, prefixLength).map((text) => ({ text })),
		...buildMiddleDiffRecords(
			baselineLines.slice(prefixLength, baselineLines.length - suffixLength),
			latestLines.slice(prefixLength, latestLines.length - suffixLength),
		),
		...baselineLines
			.slice(baselineLines.length - suffixLength)
			.map((text) => ({ text })),
	];

	const lineTones = new Map<number, SyntheticDiffLineTone>();
	for (let index = 0; index < records.length; index += 1) {
		const tone = records[index].tone;
		if (tone) lineTones.set(index + 1, tone);
	}
	if (lineTones.size === 0) return null;

	const changedLines = [...lineTones.keys()];
	return {
		content: records.map((record) => record.text).join('\n'),
		lineTones,
		firstLine: Math.min(...changedLines),
		latestLine: Math.max(...changedLines),
	};
}
