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
		});
	});
});
