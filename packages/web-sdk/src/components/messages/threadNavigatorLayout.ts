/**
 * Layout decision for the thread quick-jump navigator rail.
 *
 * The rail is absolutely positioned at the far-left edge of the thread. In
 * roomy layouts it renders dock-style magnifying bars plus a large hover
 * preview card. In constrained thread/mobile widths those would overlap the
 * message content, so the rail collapses to a compact strip of dots/ticks and
 * uses a narrower hover preview card.
 *
 * Full-width content additionally gets modest symmetric horizontal spacing on
 * the message rows (see MessageThread) so the left rail/timeline and the right
 * edge both have breathing room; the rail itself always stays on the left.
 */
export interface ThreadNavigatorLayout {
	/** Whether the rail should render in its compact (dots/ticks) form. */
	compact: boolean;
	/** Total interactive width reserved for the rail, in px. */
	railWidth: number;
	/** Minimum marker width (px). */
	barMinWidth: number;
	/** Maximum marker width on hover magnification (px). */
	barMaxWidth: number;
	/** Whether the large hover preview card may be shown. */
	showPreviewCard: boolean;
}

/**
 * Thread widths below this (px) are treated as constrained. Mirrors the
 * `< 640` breakpoint already used for compact thread density so the rail and
 * the message rows switch modes together.
 */
export const RAIL_COMPACT_MAX_WIDTH = 640;

/** Interactive rail width (px) in the roomy layout. */
export const ROOMY_RAIL_WIDTH = 30;

/** Interactive rail width (px) in the compact (dots/ticks) layout. */
export const COMPACT_RAIL_WIDTH = 14;

/** Default vertical slot height (px) for each navigator marker. */
export const DEFAULT_NAVIGATOR_ROW_HEIGHT = 14;

/**
 * Resolve the vertical slot height for each navigator marker.
 *
 * @param turnCount - Number of rendered navigator markers.
 * @param availableHeight - Measured vertical space available to the rail.
 */
export function getThreadNavigatorRowHeight(
	turnCount: number,
	availableHeight: number,
): number {
	if (turnCount <= 0 || availableHeight <= 0)
		return DEFAULT_NAVIGATOR_ROW_HEIGHT;

	return Math.min(DEFAULT_NAVIGATOR_ROW_HEIGHT, availableHeight / turnCount);
}
/**
 * Resolve the navigator rail layout for a given measured thread width.
 *
 * A width of `0` means the container has not been measured yet; in that case
 * the roomy layout is assumed to avoid a flash of the compact rail on mount.
 *
 * @param threadWidth - Measured thread width in px (0 until first measure).
 */
export function getThreadNavigatorLayout(
	threadWidth: number,
): ThreadNavigatorLayout {
	const compact = threadWidth > 0 && threadWidth < RAIL_COMPACT_MAX_WIDTH;
	if (compact) {
		return {
			compact: true,
			railWidth: COMPACT_RAIL_WIDTH,
			barMinWidth: 4,
			barMaxWidth: 8,
			showPreviewCard: true,
		};
	}
	return {
		compact: false,
		railWidth: ROOMY_RAIL_WIDTH,
		barMinWidth: 14,
		barMaxWidth: 24,
		showPreviewCard: true,
	};
}
