import { describe, expect, it } from 'bun:test';
import {
	END_FOLLOW_OPTIONS,
	createPrependRequestState,
	isEndFollowSuspended,
	markPrependRequested,
	markPrependSettled,
	resetPrependRequests,
	resolveEndFollow,
	shouldRequestPrepend,
} from '../packages/web-sdk/src/components/messages/threadPrepend';

describe('start-reached cursor latch', () => {
	it('allows the first request for a cursor', () => {
		const state = createPrependRequestState();
		expect(
			shouldRequestPrepend(state, {
				token: 'cursor-1',
				hasOlder: true,
				isLoading: false,
			}),
		).toBe(true);
	});

	it('collapses an onStartReached burst into a single fetch', () => {
		const state = createPrependRequestState();
		const input = { token: 'cursor-1', hasOlder: true, isLoading: false };

		let dispatched = 0;
		// The list fires `onStartReached` on every scroll event while the reader
		// stays inside the start threshold; only the first one may reach the
		// network.
		for (let i = 0; i < 25; i++) {
			if (shouldRequestPrepend(state, input)) {
				markPrependRequested(state, input.token);
				dispatched += 1;
			}
		}
		expect(dispatched).toBe(1);
		expect(state.requestCount).toBe(1);
	});

	it('keeps refusing the same cursor after the fetch settles', () => {
		const state = createPrependRequestState();
		const input = { token: 'cursor-1', hasOlder: true, isLoading: false };

		expect(shouldRequestPrepend(state, input)).toBe(true);
		markPrependRequested(state, input.token);
		markPrependSettled(state);

		// Re-entering the threshold must not refetch a page already loaded.
		for (let i = 0; i < 10; i++) {
			expect(shouldRequestPrepend(state, input)).toBe(false);
		}
	});

	it('allows the next page once the cursor advances', () => {
		const state = createPrependRequestState();
		markPrependRequested(state, 'cursor-1');
		markPrependSettled(state);

		expect(
			shouldRequestPrepend(state, {
				token: 'cursor-2',
				hasOlder: true,
				isLoading: false,
			}),
		).toBe(true);
	});

	it('never requests while a fetch is in flight or when nothing is older', () => {
		const state = createPrependRequestState();
		expect(
			shouldRequestPrepend(state, {
				token: 'cursor-1',
				hasOlder: true,
				isLoading: true,
			}),
		).toBe(false);
		expect(
			shouldRequestPrepend(state, {
				token: 'cursor-1',
				hasOlder: false,
				isLoading: false,
			}),
		).toBe(false);

		markPrependRequested(state, 'cursor-1');
		expect(
			shouldRequestPrepend(state, {
				token: 'cursor-2',
				hasOlder: true,
				isLoading: false,
			}),
		).toBe(false);
	});

	it('releases the latch when a fetch returns nothing new', () => {
		const state = createPrependRequestState();
		markPrependRequested(state, 'cursor-1');
		markPrependSettled(state);

		expect(isEndFollowSuspended(state)).toBe(false);
		// The dead cursor is not retried.
		expect(
			shouldRequestPrepend(state, {
				token: 'cursor-1',
				hasOlder: true,
				isLoading: false,
			}),
		).toBe(false);
	});

	it('forgets everything when the session changes', () => {
		const state = createPrependRequestState();
		markPrependRequested(state, 'cursor-1');
		resetPrependRequests(state);

		expect(state.inFlightToken).toBeNull();
		expect(isEndFollowSuspended(state)).toBe(false);
		expect(
			shouldRequestPrepend(state, {
				token: 'cursor-1',
				hasOlder: true,
				isLoading: false,
			}),
		).toBe(true);
	});

	it('runs exactly one fetch per page across a paging session', () => {
		const state = createPrependRequestState();

		for (const cursor of ['cursor-1', 'cursor-2', 'cursor-3']) {
			expect(
				shouldRequestPrepend(state, {
					token: cursor,
					hasOlder: true,
					isLoading: false,
				}),
			).toBe(true);
			markPrependRequested(state, cursor);
			// A burst of further onStartReached calls during the fetch.
			for (let i = 0; i < 5; i++) {
				expect(
					shouldRequestPrepend(state, {
						token: cursor,
						hasOlder: true,
						isLoading: true,
					}),
				).toBe(false);
			}
			markPrependSettled(state);
		}

		expect(state.requestCount).toBe(3);
	});
});

describe('end-follow during a prepend', () => {
	it('suspends following from the request until the fetch settles', () => {
		const state = createPrependRequestState();
		expect(isEndFollowSuspended(state)).toBe(false);

		markPrependRequested(state, 'cursor-1');
		expect(isEndFollowSuspended(state)).toBe(true);

		markPrependSettled(state);
		expect(isEndFollowSuspended(state)).toBe(false);
	});

	it('never re-enables following while a page is being fetched or committed', () => {
		// The reader is pinned to the bottom, which normally follows; a prepend
		// must still switch following off for its whole window so rows inserted
		// above the viewport cannot pull the view down.
		expect(
			resolveEndFollow({ disabled: false, atEnd: true, prepending: true }),
		).toBe(false);
		expect(
			resolveEndFollow({ disabled: false, atEnd: false, prepending: true }),
		).toBe(false);
	});

	it('follows only while genuinely pinned to the end', () => {
		expect(
			resolveEndFollow({ disabled: false, atEnd: true, prepending: false }),
		).toBe(END_FOLLOW_OPTIONS);
		expect(
			resolveEndFollow({ disabled: false, atEnd: false, prepending: false }),
		).toBe(false);
		expect(
			resolveEndFollow({ disabled: true, atEnd: true, prepending: false }),
		).toBe(false);
	});

	it('uses a non-animated, explicitly triggered follow', () => {
		// Animated follow scrolls queue up against each other while a turn
		// streams; the trigger set documents that following reacts to real
		// content growth only.
		expect(END_FOLLOW_OPTIONS.animated).toBe(false);
		expect(END_FOLLOW_OPTIONS.on).toEqual({
			dataChange: true,
			itemLayout: true,
			footerLayout: true,
			layout: true,
		});
	});

	it('releases following without any scroll side effect', () => {
		// The state machine exposes no scroll hooks at all: releasing a prepend
		// can only flip a boolean, never move the viewport.
		const state = createPrependRequestState();
		markPrependRequested(state, 'cursor-1');
		markPrependSettled(state);

		expect(Object.keys(state).sort()).toEqual([
			'inFlightToken',
			'phase',
			'requestCount',
			'requestedTokens',
		]);
	});
});
