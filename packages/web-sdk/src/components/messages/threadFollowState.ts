/** Distance from the true bottom at which a downward scroll resumes following. */
export const BOTTOM_RESUME_THRESHOLD_PX = 8;

/** Ignore sub-pixel scroll jitter when classifying upward movement. */
export const SCROLL_UP_TOLERANCE_PX = 2;

export interface ThreadFollowState {
	readonly following: boolean;
	readonly lastScrollTop: number | null;
	readonly lastDistanceFromBottom: number | null;
}

export type ThreadFollowEvent =
	| { type: 'scrolled'; scrollTop: number; distanceFromBottom: number }
	| { type: 'scrolled-up' }
	| { type: 'bottom-requested' }
	| { type: 'reset' };

export function createThreadFollowState(): ThreadFollowState {
	return { following: true, lastScrollTop: null, lastDistanceFromBottom: null };
}

/**
 * Keeps streaming layout changes separate from deliberate reader scrolling.
 *
 * `scrollTop` alone cannot distinguish a reader scrolling up from layout
 * moving the content under a stationary reader: a collapsing live-activity
 * box shrinks `scrollHeight` and the browser clamps `scrollTop` down, and
 * `maintainVisibleContentPosition` adjusts `scrollTop` when a row above the
 * viewport re-measures smaller. Both look like an upward scroll but keep the
 * reader the same distance from the bottom (or closer). A *real* upward
 * scroll moves the reader **away** from the bottom, so detaching requires
 * both signals: `scrollTop` decreased *and* `distanceFromBottom` increased.
 */
export function reduceThreadFollow(
	state: ThreadFollowState,
	event: ThreadFollowEvent,
): ThreadFollowState {
	switch (event.type) {
		case 'reset': {
			const next = createThreadFollowState();
			return state.following &&
				state.lastScrollTop === null &&
				state.lastDistanceFromBottom === null
				? state
				: next;
		}
		case 'bottom-requested':
			return state.following ? state : { ...state, following: true };
		case 'scrolled-up':
			return state.following ? { ...state, following: false } : state;
		case 'scrolled': {
			if (
				state.lastScrollTop === null ||
				state.lastDistanceFromBottom === null
			) {
				return {
					...state,
					lastScrollTop: event.scrollTop,
					lastDistanceFromBottom: event.distanceFromBottom,
				};
			}

			const delta = event.scrollTop - state.lastScrollTop;
			const distanceDelta =
				event.distanceFromBottom - state.lastDistanceFromBottom;
			const atBottom = event.distanceFromBottom <= BOTTOM_RESUME_THRESHOLD_PX;
			const movedUp =
				delta < -SCROLL_UP_TOLERANCE_PX &&
				distanceDelta > SCROLL_UP_TOLERANCE_PX;
			if (movedUp && !atBottom) {
				return {
					following: false,
					lastScrollTop: event.scrollTop,
					lastDistanceFromBottom: event.distanceFromBottom,
				};
			}

			const following = state.following || (delta > 0 && atBottom);
			return {
				following,
				lastScrollTop: event.scrollTop,
				lastDistanceFromBottom: event.distanceFromBottom,
			};
		}
	}
}
