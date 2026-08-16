/** Cursor shapes the inline Ghostty canvas can draw. */
export type TerminalCursorShape = 'block' | 'underline' | 'bar' | 'blockHollow';

/** High-level cursor presentation for a single paint. */
export type TerminalCursorDisplay = 'solid' | 'hidden' | 'hollow';

/**
 * Decide how the cursor should appear for the current focus/blink phase.
 * Unfocused terminals always use a steady hollow block; focused terminals
 * honor the model blink flag and the local blink phase.
 */
export function resolveTerminalCursorDisplay(options: {
	focused: boolean;
	modelVisible: boolean;
	modelBlinking: boolean;
	blinkPhaseVisible: boolean;
}): TerminalCursorDisplay {
	if (!options.modelVisible) return 'hidden';
	if (!options.focused) return 'hollow';
	if (options.modelBlinking && !options.blinkPhaseVisible) return 'hidden';
	return 'solid';
}

/**
 * Map a display mode + terminal-requested style to the concrete shape to draw.
 * Blur always forces a bordered block regardless of DECSCUSR style.
 */
export function resolveTerminalCursorShape(
	display: TerminalCursorDisplay,
	modelStyle: TerminalCursorShape = 'block',
): TerminalCursorShape | null {
	if (display === 'hidden') return null;
	if (display === 'hollow') return 'blockHollow';
	if (modelStyle === 'blockHollow') return 'block';
	return modelStyle;
}

/** Official ghostty-vt CURSOR_VISUAL_STYLE enum values. */
export function mapGhosttyCursorVisualStyle(
	value: number,
): TerminalCursorShape {
	switch (value) {
		case 0:
			return 'bar';
		case 2:
			return 'underline';
		case 3:
			return 'blockHollow';
		default:
			return 'block';
	}
}

export interface TerminalCursorDrawRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Compute the canvas-space geometry for a cursor cell. Pure helper for tests
 * and for the inline terminal overlay painter.
 */
export function terminalCursorCellRect(
	col: number,
	row: number,
	cellWidth: number,
	cellHeight: number,
): TerminalCursorDrawRect {
	return {
		x: col * cellWidth,
		y: row * cellHeight,
		width: cellWidth,
		height: cellHeight,
	};
}

/** Draw a solid/hollow cursor into a 2D canvas context (CSS pixel space). */
export function drawTerminalCursor(
	ctx: Pick<
		CanvasRenderingContext2D,
		'fillStyle' | 'strokeStyle' | 'fillRect' | 'strokeRect' | 'globalAlpha'
	>,
	options: {
		shape: TerminalCursorShape;
		color: string;
		rect: TerminalCursorDrawRect;
	},
): void {
	const { shape, color, rect } = options;
	const { x, y, width, height } = rect;
	ctx.fillStyle = color;
	switch (shape) {
		case 'bar': {
			const barWidth = Math.max(2, Math.floor(width * 0.15));
			ctx.fillRect(x, y, barWidth, height);
			break;
		}
		case 'underline': {
			const underline = Math.max(2, Math.floor(height * 0.15));
			ctx.fillRect(x, y + height - underline, width, underline);
			break;
		}
		case 'blockHollow': {
			ctx.strokeStyle = color;
			ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
			break;
		}
		default: {
			ctx.globalAlpha = 0.85;
			ctx.fillRect(x, y, width, height);
			ctx.globalAlpha = 1;
			break;
		}
	}
}
