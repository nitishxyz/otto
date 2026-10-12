/** Shared UTF-8 byte-budget helpers for tool results shown to models. */

export function byteLength(text: string): number {
	return Buffer.byteLength(text, 'utf8');
}

export function takeFirstBytes(text: string, bytes: number): string {
	if (byteLength(text) <= bytes) return text;
	return Buffer.from(text, 'utf8').subarray(0, bytes).toString('utf8');
}

export function takeLastBytes(text: string, bytes: number): string {
	const buffer = Buffer.from(text, 'utf8');
	if (buffer.byteLength <= bytes) return text;
	return buffer.subarray(buffer.byteLength - bytes).toString('utf8');
}

export type CompactedText = {
	text: string;
	truncated: boolean;
	originalBytes: number;
	shownBytes: number;
};

/** Keeps the head and tail of `text` within `maxBytes`, marking the gap. */
export function compactText(
	text: string,
	maxBytes: number,
	label: string,
): CompactedText {
	const originalBytes = byteLength(text);
	if (originalBytes <= maxBytes) {
		return { text, truncated: false, originalBytes, shownBytes: originalBytes };
	}

	const marker = `\n… omitted ${originalBytes - maxBytes} bytes from ${label} …\n`;
	const markerBytes = byteLength(marker);
	const contentBudget = Math.max(0, maxBytes - markerBytes);
	const headBytes = Math.floor(contentBudget / 2);
	const tailBytes = contentBudget - headBytes;
	const compacted = `${takeFirstBytes(text, headBytes)}${marker}${takeLastBytes(
		text,
		tailBytes,
	)}`;

	return {
		text: compacted,
		truncated: true,
		originalBytes,
		shownBytes: byteLength(compacted),
	};
}
