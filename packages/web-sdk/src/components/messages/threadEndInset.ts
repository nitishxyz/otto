/**
 * Trailing-space model for the thread list's end.
 *
 * The default thread renders under a floating composer (`ChatInput`, marked
 * with `data-chat-input-boundary`). Instead of guessing the composer's height
 * with a hard-coded footer padding, the thread measures the composer's real
 * overlap over the thread root (via ResizeObserver) and feeds the result to
 * LegendList's web-only `contentInsetEndAdjustment` — real trailing scroll
 * range that stays aligned with `scrollToEnd`/end pinning and tracks composer
 * growth (multiline input, session bars) frame-accurately.
 */

/**
 * Deliberate breathing room between the last row and the composer's top edge,
 * matching the roomy row gap (`pb-6`). Anything larger re-creates the dead
 * band the hard-coded `pb-80`/`pb-96` spacer produced.
 */
export const THREAD_END_BREATHING_ROOM_PX = 24;

/**
 * Resolves the list's trailing end inset from the measured composer overlap.
 *
 * Non-finite or negative measurements (unmounted boundary, mid-layout reads)
 * degrade to just the breathing room instead of poisoning the scroll range.
 * The result is rounded so a fractional overlap cannot ping-pong the inset
 * across renders.
 */
export function resolveThreadEndInset(
	composerOverlapPx: number,
	breathingRoomPx: number = THREAD_END_BREATHING_ROOM_PX,
): number {
	const overlap =
		Number.isFinite(composerOverlapPx) && composerOverlapPx > 0
			? composerOverlapPx
			: 0;
	const room =
		Number.isFinite(breathingRoomPx) && breathingRoomPx > 0
			? breathingRoomPx
			: 0;
	return Math.round(overlap + room);
}
