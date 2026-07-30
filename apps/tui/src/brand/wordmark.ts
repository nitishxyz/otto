export const OTTO_TUI_WORDMARK_MARKERS = '_^~,' as const;

export interface OttoTuiGlyph {
	key: 'o1' | 't1' | 't2' | 'o2';
	face: string;
	cast: string;
	trimLeft: 0 | 1;
	lines: readonly [string, string, string, string];
}

/** Four-row block glyphs with marker cells for the NeoPop hard extrusion. */
export const OTTO_TUI_GLYPHS: readonly OttoTuiGlyph[] = [
	{
		key: 'o1',
		face: '#4865cc',
		cast: '#283c8c',
		trimLeft: 0,
		lines: ['     ', '█▀▀█ ', '█,,█ ', '▀▀▀▀ '],
	},
	{
		key: 't1',
		face: '#c9403a',
		cast: '#84241f',
		trimLeft: 1,
		lines: ['  █  ', ' ▀█▀ ', '  █, ', '  ▀▀ '],
	},
	{
		key: 't2',
		face: '#c9403a',
		cast: '#84241f',
		trimLeft: 1,
		lines: ['  █  ', ' ▀█▀ ', '  █, ', '  ▀▀ '],
	},
	{
		key: 'o2',
		face: '#62ad8b',
		cast: '#346852',
		trimLeft: 0,
		lines: ['     ', '█▀▀█ ', '█,,█ ', '▀▀▀▀ '],
	},
] as const;

export const OTTO_TUI_WORDMARK_HEIGHT = OTTO_TUI_GLYPHS[0].lines.length;
export const OTTO_TUI_WORDMARK_GAPS = [0, 0, 0] as const;
export const OTTO_TUI_WORDMARK_WIDTH =
	OTTO_TUI_GLYPHS.reduce(
		(width, glyph) => width + glyph.lines[0].length - glyph.trimLeft,
		0,
	) + OTTO_TUI_WORDMARK_GAPS.reduce((width, gap) => width + gap, 0);
export const OTTO_TUI_FULL_MIN_WIDTH = OTTO_TUI_WORDMARK_WIDTH + 4;

export type OttoTuiWordmarkVariant = 'auto' | 'full' | 'compact';

export function resolveOttoWordmarkVariant(
	terminalWidth: number,
	variant: OttoTuiWordmarkVariant,
): Exclude<OttoTuiWordmarkVariant, 'auto'> {
	if (variant !== 'auto') return variant;
	return terminalWidth >= OTTO_TUI_FULL_MIN_WIDTH ? 'full' : 'compact';
}

/** Plain block preview used by tests and terminals without per-cell styling. */
export function renderOttoWordmarkPlain(): string[] {
	return Array.from({ length: OTTO_TUI_WORDMARK_HEIGHT }, (_, row) =>
		OTTO_TUI_GLYPHS.map((glyph, index) => {
			const line = glyph.lines[row]
				.slice(glyph.trimLeft)
				.replaceAll('_', ' ')
				.replaceAll('^', '▀')
				.replaceAll('~', '▀')
				.replaceAll(',', '▄');
			const gap = OTTO_TUI_WORDMARK_GAPS[index] ?? 0;
			return `${line}${' '.repeat(gap)}`;
		}).join(''),
	);
}
