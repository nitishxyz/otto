const BULLET_COMMAND_PATTERN =
	/\b(?:bullet point|next bullet|dash item)\b[,:.]?\s*/gi;
const NUMBERED_COMMAND_PATTERN =
	/\bnumber\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b[,:.]?\s*/gi;
const ORDINAL_PATTERN =
	/\b(first|second|third|fourth|fifth|sixth|finally)\b[,:]\s+/gi;
const LAYOUT_COMMAND_PATTERN = /\b(new paragraph|new line)\b([.,;:]?)[ \t]*/gi;
const NATURAL_LIST_LEAD_PATTERN =
	/\bthere (?:are|is)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:things?|items?|steps?|checks?|points?)\b[^.!?]*[.!?]\s*/i;

const SPOKEN_NUMBERS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
};

const ORDINAL_NUMBERS: Record<string, number> = {
	first: 1,
	second: 2,
	third: 3,
	fourth: 4,
	fifth: 5,
	sixth: 6,
};

type ListMarker = {
	index: number;
	end: number;
	number?: number;
};

/** Formats spoken layout commands and clear list sequences as Markdown. */
export function formatDictationTranscript(text: string): string {
	const withBreaks = formatLayoutCommands(text);
	const withNumberedCommands = formatNumberedCommands(withBreaks);
	const withBulletCommands = formatBulletCommands(withNumberedCommands);
	const withOrdinalList = hasMarkdownList(withBulletCommands)
		? withBulletCommands
		: formatOrdinalList(withBulletCommands);
	const formatted = hasMarkdownList(withOrdinalList)
		? withOrdinalList
		: formatNaturalList(withOrdinalList);
	return formatted
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function formatNaturalList(text: string): string {
	const lead = NATURAL_LIST_LEAD_PATTERN.exec(text);
	if (!lead || lead.index === undefined) return text;
	const expectedValue = lead[1]?.toLocaleLowerCase();
	const expectedCount = expectedValue
		? (SPOKEN_NUMBERS[expectedValue] ?? Number(expectedValue))
		: 0;
	if (!Number.isFinite(expectedCount) || expectedCount < 2) return text;

	const listText = text.slice(lead.index + lead[0].length).trim();
	if (!listText || /[.!?]\s+\S/.test(listText.replace(/[.!?]$/, ''))) {
		return text;
	}
	const items = listText
		.replace(/[.!?]$/, '')
		.replace(/,\s+(?:and|or)\s+/i, ', ')
		.split(/\s*[,;]\s*/)
		.map((item) => item.trim())
		.filter(Boolean);
	if (items.length < 2 || Math.abs(items.length - expectedCount) > 1)
		return text;

	const prefix = text.slice(0, lead.index).trim();
	const introduction = lead[0].trim().replace(/[.!?]$/, ':');
	const heading = prefix ? `${prefix} ${introduction}` : introduction;
	return `${heading}\n\n${items.map((item) => `- ${item}`).join('\n')}`;
}

function formatLayoutCommands(text: string): string {
	const pattern = new RegExp(LAYOUT_COMMAND_PATTERN.source, 'gi');
	let formatted = '';
	let cursor = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index;
		if (index === undefined || !isLayoutCommand(text, index, match)) continue;
		formatted += text.slice(cursor, index).trimEnd();
		formatted +=
			match[1]?.toLocaleLowerCase() === 'new paragraph' ? '\n\n' : '\n';
		cursor = index + match[0].length;
	}

	function isLayoutCommand(
		text: string,
		index: number,
		match: RegExpMatchArray,
	): boolean {
		if (!isCommandBoundary(text, index)) return false;
		if (match[2]) return true;
		const next = text
			.slice(index + match[0].length)
			.trimStart()
			.at(0);
		return next === undefined || next === next.toLocaleUpperCase();
	}
	return cursor === 0 ? text : `${formatted}${text.slice(cursor)}`;
}

function formatBulletCommands(text: string): string {
	const markers = collectMarkers(text, BULLET_COMMAND_PATTERN);
	if (markers.length === 0) return text;
	return formatList(text, markers, () => '- ');
}

function formatNumberedCommands(text: string): string {
	const pattern = new RegExp(NUMBERED_COMMAND_PATTERN.source, 'gi');
	const markers: ListMarker[] = [];
	for (const match of text.matchAll(pattern)) {
		if (!isCommandBoundary(text, match.index)) continue;
		const value = match[1]?.toLocaleLowerCase();
		const number = value ? (SPOKEN_NUMBERS[value] ?? Number(value)) : 0;
		if (Number.isFinite(number) && number >= 1) {
			markers.push({
				index: match.index,
				end: match.index + match[0].length,
				number,
			});
		}
	}
	if (!isSequential(markers)) return text;
	return formatList(text, markers, (marker) => `${marker.number}. `);
}

function formatOrdinalList(text: string): string {
	const pattern = new RegExp(ORDINAL_PATTERN.source, 'gi');
	const markers: ListMarker[] = [];
	for (const match of text.matchAll(pattern)) {
		if (!isSentenceBoundary(text, match.index)) continue;
		const value = match[1]?.toLocaleLowerCase();
		const previousNumber = markers.at(-1)?.number ?? 0;
		markers.push({
			index: match.index,
			end: match.index + match[0].length,
			number:
				value === 'finally' ? previousNumber + 1 : ORDINAL_NUMBERS[value ?? ''],
		});
	}
	if (!isSequential(markers)) return text;
	return formatList(text, markers, (marker) => `${marker.number}. `);
}

function collectMarkers(text: string, source: RegExp): ListMarker[] {
	const pattern = new RegExp(source.source, 'gi');
	return Array.from(text.matchAll(pattern))
		.filter((match) => isCommandBoundary(text, match.index))
		.map((match) => ({
			index: match.index,
			end: match.index + match[0].length,
		}));
}

function formatList(
	text: string,
	markers: ListMarker[],
	prefix: (marker: ListMarker, index: number) => string,
): string {
	const intro = text.slice(0, markers[0].index).trim();
	const items = markers
		.map((marker, index) => {
			const end = markers[index + 1]?.index ?? text.length;
			const item = text
				.slice(marker.end, end)
				.trim()
				.replace(index < markers.length - 1 ? /,$/ : /$^/, '');
			return item ? `${prefix(marker, index)}${item}` : '';
		})
		.filter(Boolean);
	if (items.length === 0) return text;
	return intro ? `${intro}\n\n${items.join('\n')}` : items.join('\n');
}

function isSequential(markers: ListMarker[]): boolean {
	if (markers.length < 2 || markers[0].number !== 1) return false;
	return markers.every(
		(marker, index) =>
			index === 0 || marker.number === (markers[index - 1]?.number ?? 0) + 1,
	);
}

function isCommandBoundary(text: string, index: number): boolean {
	if (index === 0) return true;
	const previous = text.slice(0, index).trimEnd().at(-1);
	return previous === undefined || /[,.!?;:\n]/.test(previous);
}

function isSentenceBoundary(text: string, index: number): boolean {
	if (index === 0) return true;
	const previous = text.slice(0, index).trimEnd().at(-1);
	return previous === undefined || /[.!?;:\n]/.test(previous);
}

function hasMarkdownList(text: string): boolean {
	return /^(?:- |\d+\. )/m.test(text);
}
