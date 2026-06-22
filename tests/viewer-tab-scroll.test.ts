import { describe, expect, test } from 'bun:test';
import { getScrollLeftToRevealTarget } from '../packages/web-sdk/src/lib/viewerTabScroll';

describe('viewer tab scroll helpers', () => {
	test('does not scroll when the target is already visible', () => {
		expect(
			getScrollLeftToRevealTarget({
				containerLeft: 0,
				containerRight: 300,
				targetLeft: 20,
				targetRight: 180,
				currentScrollLeft: 40,
			}),
		).toBeNull();
	});

	test('scrolls left just enough to reveal a clipped target', () => {
		expect(
			getScrollLeftToRevealTarget({
				containerLeft: 0,
				containerRight: 300,
				targetLeft: -30,
				targetRight: 120,
				currentScrollLeft: 80,
			}),
		).toBe(46);
	});

	test('scrolls right just enough to reveal a clipped target', () => {
		expect(
			getScrollLeftToRevealTarget({
				containerLeft: 0,
				containerRight: 300,
				targetLeft: 220,
				targetRight: 340,
				currentScrollLeft: 80,
			}),
		).toBe(124);
	});

	test('never returns a negative scroll position', () => {
		expect(
			getScrollLeftToRevealTarget({
				containerLeft: 0,
				containerRight: 300,
				targetLeft: -20,
				targetRight: 120,
				currentScrollLeft: 5,
			}),
		).toBe(0);
	});
});
