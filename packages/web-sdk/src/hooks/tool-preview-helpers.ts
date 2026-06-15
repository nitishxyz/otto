export type StringEditPreview = {
	oldString: string;
	newString: string;
};

type ExtractedJsonString = {
	value: string;
	endIndex: number;
	closed: boolean;
};

function bestEffortUnescapeJsonString(value: string): string {
	try {
		return JSON.parse(`"${value.replace(/\\$/, '')}"`) as string;
	} catch {
		return value
			.replace(/\\n/g, '\n')
			.replace(/\\t/g, '\t')
			.replace(/\\r/g, '\r')
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, '\\');
	}
}

function extractJsonStringFieldAt(
	text: string,
	field: string,
	startIndex: number,
	requireClosed = false,
): ExtractedJsonString | undefined {
	const marker = `"${field}"`;
	const markerIndex = text.indexOf(marker, Math.max(0, startIndex));
	if (markerIndex === -1) return undefined;

	const colonIndex = text.indexOf(':', markerIndex + marker.length);
	if (colonIndex === -1) return undefined;

	const quoteIndex = text.indexOf('"', colonIndex + 1);
	if (quoteIndex === -1) return undefined;

	let escaped = '';
	let escaping = false;
	let closed = false;
	let endIndex = text.length;
	for (let i = quoteIndex + 1; i < text.length; i += 1) {
		const char = text[i];
		if (escaping) {
			escaped += `\\${char}`;
			escaping = false;
			continue;
		}

		if (char === '\\') {
			escaping = true;
			continue;
		}

		if (char === '"') {
			closed = true;
			endIndex = i + 1;
			break;
		}
		escaped += char;
	}

	if (requireClosed && !closed) return undefined;
	return {
		value: bestEffortUnescapeJsonString(escaped),
		endIndex,
		closed,
	};
}

export function extractStreamingMultiEditPreviewEdits(
	buffer: string,
): StringEditPreview[] {
	const editsStart = buffer.indexOf('"edits"');
	if (editsStart === -1) return [];

	const edits: StringEditPreview[] = [];
	let cursor = editsStart;
	const maxPreviewEdits = 50;
	while (cursor < buffer.length && edits.length < maxPreviewEdits) {
		const oldString = extractJsonStringFieldAt(
			buffer,
			'oldString',
			cursor,
			true,
		);
		if (!oldString) break;

		const newString = extractJsonStringFieldAt(
			buffer,
			'newString',
			oldString.endIndex,
			false,
		);
		if (!newString) break;

		edits.push({ oldString: oldString.value, newString: newString.value });
		cursor = Math.max(newString.endIndex, oldString.endIndex + 1);
		if (!newString.closed) break;
	}

	return edits;
}
