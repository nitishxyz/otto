/**
 * End-follow latch for the message thread.
 *
 * LegendList is the only component that ever scrolls the thread, and it only
 * follows the live edge while `maintainScrollAtEnd` is enabled. Deciding when
 * that is true is the entire job of this module, so the rule can be tested
 * without a DOM:
 *
 *  - Following starts on, because a freshly mounted thread lands at the end.
 *  - Any upward movement — a wheel tick, a downward finger drag, or a scroll
 *    event whose offset decreased — latches following **off**.
 *  - Following is only ever re-armed by an explicit reader action: moving the
 *    viewport *downward* onto the true bottom, pressing "scroll to bottom", or
 *    sending a message.
 *
 * The critical property is the last one. A streaming turn constantly changes
 * the content size, so "the viewport is currently near the end" is not a
 * statement about reader intent: measurements landing, a live activity box
 * collapsing or a footer resizing can all make the distance to the end shrink
 * for a frame. Re-arming on that alone is what yanked a detached reader back
 * down mid-stream, so a resume additionally requires the scroll *offset* to
 * have moved downward, which only a reader (or an explicit request) can do.
 */

/**
 * True-bottom tolerance. Following resumes only when the reader is essentially
 * pinned to the end, not merely "near" it.
 */
export const BOTTOM_RESUME_THRESHOLD_PX = 8;

/**
 * Ignore sub-pixel/rubber-band jitter when classifying a scroll as upward.
 * Any measurable downward movement counts, so a reader landing exactly on the
 * bottom with a 1px final delta still re-arms.
 */
export const SCROLL_UP_TOLERANCE_PX = 2;

export interface ThreadFollowState {
	/** Whether LegendList may keep the viewport pinned to the live edge. */
	readonly following: boolean;
	/** Last observed scroll offset, used to classify the next event. */
	readonly lastScrollTop: number;
}

export type ThreadFollowEvent =
	/** A scroll event from the list's scroll view. Read-only sampling. */
	| { type: 'scrolled'; scrollTop: number; distanceFromBottom: number }
	/** Unambiguous upward intent (wheel up, finger dragging down). */
	| { type: 'scrolled-up' }
	/** Explicit "take me to the live edge": the button, or sending a message. */
	| { type: 'bottom-requested' }
	/** A new session mounted its own list. */
	| { type: 'reset' };

export function createThreadFollowState(): ThreadFollowState {
	return { following: true, lastScrollTop: 0 };
}

/**
 * Applies one event to the latch. Returns the *same* object when nothing
 * changed so callers can skip React updates on the hot scroll path.
 */
export function reduceThreadFollow(
	state: ThreadFollowState,
	event: ThreadFollowEvent,
): ThreadFollowState {
	switch (event.type) {
		case 'reset': {
			const next = createThreadFollowState();
			return state.following && state.lastScrollTop === 0 ? state : next;
		}
		case 'bottom-requested':
			return state.following ? state : { ...state, following: true };
		case 'scrolled-up':
			return state.following ? { ...state, following: false } : state;
		case 'scrolled': {
			const delta = event.scrollTop - state.lastScrollTop;
			const atBottom = event.distanceFromBottom <= BOTTOM_RESUME_THRESHOLD_PX;

			// Follow scrolls only ever move downward, so a decreasing offset is
			// always reader-initiated. Inside the bottom band it is handled by
			// the explicit `scrolled-up` intent instead, so a content shrink that
			// clamps the offset cannot be mistaken for a reader scrolling up.
			if (delta < -SCROLL_UP_TOLERANCE_PX && !atBottom) {
				return { following: false, lastScrollTop: event.scrollTop };
			}

			// Resuming requires *both* a downward movement and the true bottom.
			// Streaming layout changes move `distanceFromBottom` without moving
			// the offset, so they can never re-arm following on their own.
			const following = state.following || (delta > 0 && atBottom);
			return { following, lastScrollTop: event.scrollTop };
		}
	}
}

/**
 * Convenience predicate for tests and callers that only need the flag.
 */
export function isFollowing(state: ThreadFollowState): boolean {
	return state.following;
}
