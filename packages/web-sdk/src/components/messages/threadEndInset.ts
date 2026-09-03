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

export type ThreadEndDensity = 'normal' | 'compact';

/**
 * Deliberate breathing room between the last row and the composer's top edge
 * in roomy density. The floating composer draws a 64px gradient fade
 * (`pt-16`) above its boundary; matching that step keeps the last row fully
 * clear of the fade instead of visually flush against the input. Anything
 * much larger re-creates the dead band the old hard-coded `pb-96` spacer
 * produced.
 */
export const THREAD_END_BREATHING_ROOM_PX = 64;

/** Compact-density breathing room: one Tailwind step tighter (`pb-12`). */
export const THREAD_END_BREATHING_ROOM_COMPACT_PX = 48;

/** Existing resting position for the scroll-to-bottom control (`bottom-36`). */
export const THREAD_SCROLL_BUTTON_MIN_OFFSET_PX = 144;

/** Density-resolved breathing room between the last row and the composer. */
export function getThreadEndBreathingRoom(density: ThreadEndDensity): number {
	return density === 'compact'
		? THREAD_END_BREATHING_ROOM_COMPACT_PX
		: THREAD_END_BREATHING_ROOM_PX;
}

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

/**
 * Keeps the scroll-to-bottom control above the complete composer stack while
 * preserving its established resting position when the composer is short.
 */
export function resolveThreadScrollButtonOffset(endInsetPx: number): number {
	const inset =
		Number.isFinite(endInsetPx) && endInsetPx > 0 ? Math.round(endInsetPx) : 0;
	return Math.max(THREAD_SCROLL_BUTTON_MIN_OFFSET_PX, inset);
}
