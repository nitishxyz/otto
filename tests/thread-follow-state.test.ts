import { describe, expect, test } from 'bun:test';
import {
	BOTTOM_RESUME_THRESHOLD_PX,
	createThreadFollowState,
	reduceThreadFollow,
	type ThreadFollowEvent,
	type ThreadFollowState,
} from '../packages/web-sdk/src/components/messages/threadFollowState';

function run(
	state: ThreadFollowState,
	events: ThreadFollowEvent[],
): ThreadFollowState {
	return events.reduce(reduceThreadFollow, state);
}

describe('thread follow state', () => {
	test('starts armed at the live edge', () => {
		expect(createThreadFollowState()).toEqual({
			following: true,
			lastScrollTop: null,
			lastDistanceFromBottom: null,
		});
	});

	test('does not detach when streaming content grows below the viewport', () => {
		let state = reduceThreadFollow(createThreadFollowState(), {
			type: 'scrolled',
			scrollTop: 4000,
			distanceFromBottom: 0,
		});

		for (const distanceFromBottom of [20, 80, 160, 320]) {
			state = reduceThreadFollow(state, {
				type: 'scrolled',
				scrollTop: 4000,
				distanceFromBottom,
			});
			expect(state.following).toBe(true);
		}
	});

	test('detaches on explicit upward wheel or touch intent', () => {
		const state = reduceThreadFollow(createThreadFollowState(), {
			type: 'scrolled-up',
		});
		expect(state.following).toBe(false);
	});

	test('detaches when a scrollbar or keyboard scroll moves upward', () => {
		const state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 4000, distanceFromBottom: 0 },
			{ type: 'scrolled', scrollTop: 2500, distanceFromBottom: 1500 },
		]);
		expect(state.following).toBe(false);
	});

	test('stays detached throughout streaming layout changes', () => {
		let state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 4000, distanceFromBottom: 0 },
			{ type: 'scrolled-up' },
			{ type: 'scrolled', scrollTop: 2500, distanceFromBottom: 1500 },
		]);

		for (const distanceFromBottom of [1600, 0, 4, 1800]) {
			state = reduceThreadFollow(state, {
				type: 'scrolled',
				scrollTop: 2500,
				distanceFromBottom,
			});
			expect(state.following).toBe(false);
		}
	});

	test('resumes after the reader scrolls down to the true bottom', () => {
		const state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 4000, distanceFromBottom: 0 },
			{ type: 'scrolled-up' },
			{ type: 'scrolled', scrollTop: 2000, distanceFromBottom: 2000 },
			{
				type: 'scrolled',
				scrollTop: 4000,
				distanceFromBottom: BOTTOM_RESUME_THRESHOLD_PX,
			},
		]);
		expect(state.following).toBe(true);
	});

	test('resumes on send, button click, and session reset', () => {
		const detached = reduceThreadFollow(createThreadFollowState(), {
			type: 'scrolled-up',
		});
		expect(
			reduceThreadFollow(detached, { type: 'bottom-requested' }).following,
		).toBe(true);
		expect(reduceThreadFollow(detached, { type: 'reset' })).toEqual({
			following: true,
			lastScrollTop: null,
			lastDistanceFromBottom: null,
		});
	});

	test('stays following when a collapsing row clamps scrollTop at the bottom', () => {
		// A live activity box collapsing at the tail shrinks scrollHeight; the
		// browser clamps scrollTop down while the reader stays pinned at the
		// bottom. That must not read as "scrolled up".
		const state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 4000, distanceFromBottom: 0 },
			{ type: 'scrolled', scrollTop: 3740, distanceFromBottom: 0 },
		]);
		expect(state.following).toBe(true);
	});

	test('stays following when layout moves scrollTop without moving the reader', () => {
		// maintainVisibleContentPosition adjusts scrollTop when a row above the
		// viewport re-measures smaller; the reader keeps the same distance from
		// the bottom. A streaming follower momentarily 40px above the bottom
		// must survive that adjustment.
		const state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 4000, distanceFromBottom: 40 },
			{ type: 'scrolled', scrollTop: 3700, distanceFromBottom: 40 },
		]);
		expect(state.following).toBe(true);
	});

	test('stays following through an animated collapse emitting many clamp samples', () => {
		let state = reduceThreadFollow(createThreadFollowState(), {
			type: 'scrolled',
			scrollTop: 4000,
			distanceFromBottom: 24,
		});
		// max-height transition shrinks the tail row over several frames; each
		// frame clamps scrollTop while distance-from-bottom only shrinks.
		for (const [scrollTop, distanceFromBottom] of [
			[3950, 20],
			[3890, 12],
			[3820, 4],
			[3740, 0],
		] as const) {
			state = reduceThreadFollow(state, {
				type: 'scrolled',
				scrollTop,
				distanceFromBottom,
			});
			expect(state.following).toBe(true);
		}
	});

	test('still detaches when an upward scroll coincides with content shrink', () => {
		// A real scrollbar/keyboard scroll up moves the reader away from the
		// bottom even while content is shrinking.
		const state = run(createThreadFollowState(), [
			{ type: 'scrolled', scrollTop: 4000, distanceFromBottom: 0 },
			{ type: 'scrolled', scrollTop: 3200, distanceFromBottom: 540 },
		]);
		expect(state.following).toBe(false);
	});
});
