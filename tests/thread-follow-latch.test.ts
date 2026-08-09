import { describe, expect, it } from 'bun:test';
import {
	BOTTOM_RESUME_THRESHOLD_PX,
	createThreadFollowState,
	reduceThreadFollow,
	type ThreadFollowEvent,
	type ThreadFollowState,
} from '../packages/web-sdk/src/components/messages/threadFollowState';
import {
	END_FOLLOW_OPTIONS,
	resolveEndFollow,
} from '../packages/web-sdk/src/components/messages/threadPrepend';

function run(
	state: ThreadFollowState,
	events: ThreadFollowEvent[],
): ThreadFollowState {
	return events.reduce(reduceThreadFollow, state);
}

/** The `maintainScrollAtEnd` prop MessageThread would emit for a latch state. */
function listFollowProp(state: ThreadFollowState, prepending = false) {
	return resolveEndFollow({
		disabled: false,
		atEnd: state.following,
		prepending,
	});
}

describe('thread follow latch', () => {
	it('starts armed, because a fresh list lands at the end', () => {
		expect(createThreadFollowState().following).toBe(true);
	});

	it('latches off on a wheel/touch scroll-up intent', () => {
		const state = reduceThreadFollow(createThreadFollowState(), {
			type: 'scrolled-up',
		});
		expect(state.following).toBe(false);
	});

	it('latches off when the scroll offset decreases away from the bottom', () => {
		const state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 4000, distanceFromBottom: 0 },
			{ type: 'scrolled', scrollTop: 2400, distanceFromBottom: 1600 },
		]);
		expect(state.following).toBe(false);
	});

	it('stays detached across streaming row-count growth', () => {
		// The reader scrolled up; the turn keeps appending rows below the
		// viewport. Growth moves `distanceFromBottom` but never the offset, so
		// nothing here may re-arm following.
		let state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 4000, distanceFromBottom: 0 },
			{ type: 'scrolled-up' },
			{ type: 'scrolled', scrollTop: 3000, distanceFromBottom: 1000 },
		]);
		expect(state.following).toBe(false);

		for (let appended = 1; appended <= 40; appended++) {
			state = reduceThreadFollow(state, {
				type: 'scrolled',
				scrollTop: 3000,
				distanceFromBottom: 1000 + appended * 120,
			});
			expect(state.following).toBe(false);
			expect(listFollowProp(state)).toBe(false);
		}
	});

	it('stays detached when streaming measurements report the end for a frame', () => {
		// Late measurements, a live activity box collapsing or a footer resize
		// can all make the distance to the end collapse without the reader
		// moving. That must not be read as "the reader is pinned again".
		let state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 4000, distanceFromBottom: 0 },
			{ type: 'scrolled-up' },
			{ type: 'scrolled', scrollTop: 3200, distanceFromBottom: 800 },
		]);

		for (const distanceFromBottom of [800, 0, 4, 0, 900, 2, 1200]) {
			state = reduceThreadFollow(state, {
				type: 'scrolled',
				scrollTop: 3200,
				distanceFromBottom,
			});
			expect(state.following).toBe(false);
		}
	});

	it('never queues a follow operation while detached', () => {
		// `maintainScrollAtEnd` is the only follow mechanism in the thread, so
		// "no follow is queued" is exactly "the prop stays false".
		let state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 3000, distanceFromBottom: 0 },
			{ type: 'scrolled-up' },
			{ type: 'scrolled', scrollTop: 1500, distanceFromBottom: 1500 },
		]);
		const emitted = new Set<unknown>();
		for (let frame = 0; frame < 20; frame++) {
			state = reduceThreadFollow(state, {
				type: 'scrolled',
				scrollTop: 1500,
				distanceFromBottom: frame % 3 === 0 ? 0 : 600,
			});
			emitted.add(listFollowProp(state));
		}
		expect([...emitted]).toEqual([false]);
	});

	it('re-arms when the reader scrolls back down onto the true bottom', () => {
		let state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 4000, distanceFromBottom: 0 },
			{ type: 'scrolled-up' },
			{ type: 'scrolled', scrollTop: 2000, distanceFromBottom: 2000 },
		]);
		expect(state.following).toBe(false);

		state = reduceThreadFollow(state, {
			type: 'scrolled',
			scrollTop: 3400,
			distanceFromBottom: 600,
		});
		// Downward, but not at the end yet.
		expect(state.following).toBe(false);

		state = reduceThreadFollow(state, {
			type: 'scrolled',
			scrollTop: 4000,
			distanceFromBottom: BOTTOM_RESUME_THRESHOLD_PX,
		});
		expect(state.following).toBe(true);
		expect(listFollowProp(state)).toBe(END_FOLLOW_OPTIONS);
	});

	it('re-arms on an explicit bottom request (button, send)', () => {
		const detached = reduceThreadFollow(createThreadFollowState(), {
			type: 'scrolled-up',
		});
		expect(
			reduceThreadFollow(detached, { type: 'bottom-requested' }).following,
		).toBe(true);
	});

	it('re-arms per session so a new thread starts pinned', () => {
		const detached = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 900, distanceFromBottom: 0 },
			{ type: 'scrolled-up' },
		]);
		const reset = reduceThreadFollow(detached, { type: 'reset' });
		expect(reset.following).toBe(true);
		expect(reset.lastScrollTop).toBe(0);
	});

	it('keeps following while the list itself scrolls to the end', () => {
		// Follow scrolls only move downward and land at the end, so the latch
		// must not read its own effect as reader intent.
		let state = createThreadFollowState();
		for (let frame = 1; frame <= 10; frame++) {
			state = reduceThreadFollow(state, {
				type: 'scrolled',
				scrollTop: frame * 240,
				distanceFromBottom: 0,
			});
			expect(state.following).toBe(true);
		}
	});

	it('returns the same object when an event changes nothing', () => {
		const state = createThreadFollowState();
		expect(reduceThreadFollow(state, { type: 'bottom-requested' })).toBe(state);
		expect(reduceThreadFollow(state, { type: 'reset' })).toBe(state);

		const detached = reduceThreadFollow(state, { type: 'scrolled-up' });
		expect(reduceThreadFollow(detached, { type: 'scrolled-up' })).toBe(
			detached,
		);
	});

	it('suspends following while an older page is being prepended', () => {
		const pinned = createThreadFollowState();
		expect(listFollowProp(pinned, true)).toBe(false);
		expect(listFollowProp(pinned, false)).toBe(END_FOLLOW_OPTIONS);
	});
});
