/**
 * Prepend bookkeeping for the message thread.
 *
 * The message page route returns whole, non-overlapping turns: an older page
 * never splits a message and never repeats one already loaded. Loading such a
 * page inserts rows *above* the viewport.
 *
 * LegendList owns the scroll offset for that insertion — its
 * `maintainVisibleContentPosition` anchoring keeps the visible content in place
 * across a data change. Nothing in the app may measure or write `scrollTop`, so
 * this module holds only the two things the list cannot know:
 *  - which cursor has already been requested, so the `onStartReached` burst the
 *    list emits while the user sits at the top collapses into one fetch, and
 *  - whether end-following must stand down, so a prepend commit is never
 *    mistaken for "new content at the bottom".
 *
 * Both are plain logic so they can be unit tested without mounting a list.
 */

/**
 * `idle` → no prepend in flight; end-following behaves normally.
 * `fetching` → from the moment a page is requested until the fetch settles.
 * End-following is suspended for that window and released *without* scrolling.
 */
export type PrependPhase = 'idle' | 'fetching';

export interface PrependRequestState {
	phase: PrependPhase;
	/** Cursor of the request currently in flight, if any. */
	inFlightToken: string | null;
	/** Cursors already requested; a cursor is never requested twice. */
	requestedTokens: Set<string>;
	/** Diagnostics: how many fetches this state has dispatched. */
	requestCount: number;
}

export function createPrependRequestState(): PrependRequestState {
	return {
		phase: 'idle',
		inFlightToken: null,
		requestedTokens: new Set(),
		requestCount: 0,
	};
}

/** Forgets every request, e.g. when the session changes. */
export function resetPrependRequests(state: PrependRequestState) {
	state.phase = 'idle';
	state.inFlightToken = null;
	state.requestedTokens.clear();
	state.requestCount = 0;
}

export interface PrependRequestInput {
	/** Identifies the page about to be requested (the next cursor). */
	token: string | null;
	hasOlder: boolean;
	isLoading: boolean;
}

/**
 * True when a prepend should actually be dispatched. Repeated calls for the
 * same cursor — which `onStartReached` produces continuously while the user
 * stays inside the start threshold — are collapsed into one request. The list
 * owns the threshold hysteresis; this owns the cursor latch.
 */
export function shouldRequestPrepend(
	state: PrependRequestState,
	{ token, hasOlder, isLoading }: PrependRequestInput,
): boolean {
	if (!hasOlder || isLoading) return false;
	if (state.phase !== 'idle') return false;
	if (state.inFlightToken !== null) return false;
	if (token !== null && state.requestedTokens.has(token)) return false;
	return true;
}

/** Records that a prepend request was dispatched for `token`. */
export function markPrependRequested(
	state: PrependRequestState,
	token: string | null,
) {
	state.phase = 'fetching';
	state.inFlightToken = token ?? '__initial__';
	state.requestCount += 1;
	if (token !== null) state.requestedTokens.add(token);
}

/**
 * Releases the prepend once the fetch settled — successfully or not. The cursor
 * stays in `requestedTokens` so a stale `onStartReached` burst cannot
 * re-request it; a *new* page advances the cursor, which unlatches naturally.
 * Releasing never scrolls: the list has already anchored the inserted rows.
 */
export function markPrependSettled(state: PrependRequestState) {
	state.phase = 'idle';
	state.inFlightToken = null;
}

/**
 * True while end-following must stay suspended: from the request until the
 * fetch has settled and its rows have been committed.
 */
export function isEndFollowSuspended(state: PrependRequestState): boolean {
	return state.phase !== 'idle';
}

/**
 * Native end-follow configuration. LegendList only ever scrolls to the end
 * through this; the app never issues follow scrolls of its own.
 *
 * `animated: false` keeps a streaming turn from queueing overlapping animated
 * scrolls, and the explicit trigger set documents that following reacts to real
 * content growth (data, item layout, footer layout, list layout) only.
 */
export const END_FOLLOW_OPTIONS = {
	animated: false,
	on: {
		dataChange: true,
		itemLayout: true,
		footerLayout: true,
		layout: true,
	},
} as const;

export interface EndFollowInput {
	/** Caller disabled auto-scroll entirely (embedded/preview threads). */
	disabled: boolean;
	/** The reader is genuinely pinned to the bottom. */
	atEnd: boolean;
	/** An older page is being fetched or its rows are being committed. */
	prepending: boolean;
}

/**
 * `maintainScrollAtEnd` for the current frame: the options object only while
 * the reader is genuinely following, `false` otherwise. Prepending forces it
 * off so inserting rows above the viewport can never pull the reader down.
 */
export function resolveEndFollow(
	input: EndFollowInput,
): typeof END_FOLLOW_OPTIONS | false {
	if (input.disabled || input.prepending || !input.atEnd) return false;
	return END_FOLLOW_OPTIONS;
}
