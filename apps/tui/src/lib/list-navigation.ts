export interface ListNavigationKey {
	name: string;
	raw?: string;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
}

const MAX_LIST_MODAL_ROWS = 16;
const MODAL_CHROME_ROWS = 6;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function isPlainCharacter(key: ListNavigationKey, character: string): boolean {
	return (
		!key.ctrl &&
		!key.meta &&
		!key.shift &&
		(key.name === character || key.raw === character)
	);
}

/** Matches arrow keys, Ctrl+j/k, and unmodified lowercase j/k. */
export function isListUpKey(key: ListNavigationKey): boolean {
	return (
		key.name === 'up' ||
		(key.ctrl === true && key.name === 'k') ||
		isPlainCharacter(key, 'k')
	);
}

export function isListDownKey(key: ListNavigationKey): boolean {
	return (
		key.name === 'down' ||
		(key.ctrl === true && key.name === 'j') ||
		isPlainCharacter(key, 'j')
	);
}

/** Returns a fixed-size physical row window containing the selected row. */
export function getVisibleWindow(
	total: number,
	selectedIndex: number,
	maxVisible: number,
): { start: number; end: number } {
	if (total <= maxVisible) return { start: 0, end: total };
	const half = Math.floor(maxVisible / 2);
	const start = clamp(selectedIndex - half, 0, total - maxVisible);
	return { start, end: start + maxVisible };
}

/**
 * Returns a terminal-safe list window for a modal with a fixed title/footer.
 * `reservedRows` accounts for controls rendered above or below the list body.
 */
export function getListModalWindow(
	total: number,
	selectedIndex: number,
	terminalHeight: number,
	reservedRows = 0,
): { start: number; end: number; maxVisible: number } {
	const safeHeight = terminalHeight || 40;
	const maxModalHeight = Math.max(
		8,
		Math.floor(safeHeight * (safeHeight < 24 ? 0.9 : 0.78)),
	);
	const maxVisible = Math.max(
		1,
		Math.min(
			MAX_LIST_MODAL_ROWS,
			maxModalHeight - MODAL_CHROME_ROWS - reservedRows,
		),
	);
	return { ...getVisibleWindow(total, selectedIndex, maxVisible), maxVisible };
}
