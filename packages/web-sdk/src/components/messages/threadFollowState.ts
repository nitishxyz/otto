/** Distance from the true bottom at which a downward scroll resumes following. */
export const BOTTOM_RESUME_THRESHOLD_PX = 8;

/** Ignore sub-pixel scroll jitter when classifying upward movement. */
export const SCROLL_UP_TOLERANCE_PX = 2;

export interface ThreadFollowState {
	readonly following: boolean;
	readonly lastScrollTop: number | null;
}

export type ThreadFollowEvent =
	| { type: 'scrolled'; scrollTop: number; distanceFromBottom: number }
	| { type: 'scrolled-up' }
	| { type: 'bottom-requested' }
	| { type: 'reset' };

export function createThreadFollowState(): ThreadFollowState {
	return { following: true, lastScrollTop: null };
}

/** Keeps streaming layout changes separate from deliberate reader scrolling. */
export function reduceThreadFollow(
	state: ThreadFollowState,
	event: ThreadFollowEvent,
): ThreadFollowState {
	switch (event.type) {
		case 'reset': {
			const next = createThreadFollowState();
			return state.following && state.lastScrollTop === null ? state : next;
		}
		case 'bottom-requested':
			return state.following ? state : { ...state, following: true };
		case 'scrolled-up':
			return state.following ? { ...state, following: false } : state;
		case 'scrolled': {
			if (state.lastScrollTop === null) {
				return { ...state, lastScrollTop: event.scrollTop };
			}

			const delta = event.scrollTop - state.lastScrollTop;
			const atBottom = event.distanceFromBottom <= BOTTOM_RESUME_THRESHOLD_PX;
			if (delta < -SCROLL_UP_TOLERANCE_PX && !atBottom) {
				return { following: false, lastScrollTop: event.scrollTop };
			}

			const following = state.following || (delta > 0 && atBottom);
			return { following, lastScrollTop: event.scrollTop };
		}
	}
}
