import type { BorderCharacters } from '@opentui/core';

/**
 * Half-block characters for left accent rails. With `border: ['left']` only
 * the vertical char is drawn; `▌` fills the left half of the cell for a
 * chunkier, web-like accent bar than the default `│`.
 */
export const RAIL_BORDER_CHARS: BorderCharacters = {
	topLeft: '▌',
	topRight: '▌',
	bottomLeft: '▌',
	bottomRight: '▌',
	horizontal: ' ',
	vertical: '▌',
	topT: '▌',
	bottomT: '▌',
	leftT: '▌',
	rightT: '▌',
	cross: '▌',
};
