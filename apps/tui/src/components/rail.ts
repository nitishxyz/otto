import type { BorderCharacters } from '@opentui/core';

function createRailBorderChars(glyph: string): BorderCharacters {
	return {
		topLeft: glyph,
		topRight: glyph,
		bottomLeft: glyph,
		bottomRight: glyph,
		horizontal: ' ',
		vertical: glyph,
		topT: glyph,
		bottomT: glyph,
		leftT: glyph,
		rightT: glyph,
		cross: glyph,
	};
}

/** Half-block characters for prominent left accent rails. */
export const RAIL_BORDER_CHARS = createRailBorderChars('▌');

/** Three-eighths-block characters for compact left accent rails. */
export const NARROW_RAIL_BORDER_CHARS = createRailBorderChars('▍');
