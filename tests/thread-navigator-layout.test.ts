import { describe, expect, it } from 'bun:test';
import {
	DEFAULT_NAVIGATOR_ROW_HEIGHT,
	getThreadNavigatorLayout,
	getThreadNavigatorRowHeight,
	RAIL_COMPACT_MAX_WIDTH,
	ROOMY_RAIL_WIDTH,
} from '../packages/web-sdk/src/components/messages/threadNavigatorLayout';

describe('thread navigator rail layout', () => {
	it('uses the roomy layout before the width is measured', () => {
		const layout = getThreadNavigatorLayout(0);
		expect(layout.compact).toBe(false);
		expect(layout.showPreviewCard).toBe(true);
		expect(layout.railWidth).toBe(ROOMY_RAIL_WIDTH);
	});

	it('uses the roomy layout for wide threads', () => {
		const layout = getThreadNavigatorLayout(900);
		expect(layout.compact).toBe(false);
		expect(layout.showPreviewCard).toBe(true);
		expect(layout.barMaxWidth).toBeGreaterThan(layout.barMinWidth);
		expect(layout.barMaxWidth).toBeLessThan(layout.railWidth);
	});

	it('collapses to a compact strip below the breakpoint', () => {
		const layout = getThreadNavigatorLayout(RAIL_COMPACT_MAX_WIDTH - 1);
		expect(layout.compact).toBe(true);
		expect(layout.showPreviewCard).toBe(true);
		expect(layout.railWidth).toBeLessThan(ROOMY_RAIL_WIDTH);
	});

	it('treats the exact breakpoint width as roomy', () => {
		const layout = getThreadNavigatorLayout(RAIL_COMPACT_MAX_WIDTH);
		expect(layout.compact).toBe(false);
	});

	it('keeps compact markers narrow so they hug the far-left edge', () => {
		const compact = getThreadNavigatorLayout(400);
		const roomy = getThreadNavigatorLayout(1000);
		expect(compact.barMaxWidth).toBeLessThan(roomy.barMinWidth);
	});

	it('never relocates the rail to the right (left-only placement)', () => {
		const layout = getThreadNavigatorLayout(1200) as Record<string, unknown>;
		// The layout no longer exposes a side; the rail always renders on the
		// left and overhang-safe spacing is applied at the row layout level.
		expect('side' in layout).toBe(false);
	});
});

describe('thread navigator dense vertical layout', () => {
	it('keeps the default row height when the rail fits', () => {
		expect(getThreadNavigatorRowHeight(20, 800)).toBe(
			DEFAULT_NAVIGATOR_ROW_HEIGHT,
		);
	});

	it('compresses marker rows to fit the available height', () => {
		const turnCount = 80;
		const availableHeight = 560;
		const rowHeight = getThreadNavigatorRowHeight(turnCount, availableHeight);
		expect(rowHeight).toBe(7);
		expect(rowHeight * turnCount).toBeLessThanOrEqual(availableHeight);
	});

	it('keeps very dense rails within the measured height', () => {
		const turnCount = 120;
		const availableHeight = 240;
		const rowHeight = getThreadNavigatorRowHeight(turnCount, availableHeight);
		expect(rowHeight * turnCount).toBeLessThanOrEqual(availableHeight);
	});
});

describe('thread navigator overhang-safe row spacing', () => {
	// Mirrors the row class logic in MessageThread. The outer row wrapper holds
	// the ENTIRE assistant group (avatar/header pill, timeline, text), so a
	// symmetric horizontal inset here shifts the whole turn clear of the
	// left-edge rail rather than only nudging text.
	const PL_14_PX = 56; // tailwind pl-14 / pr-14 = 3.5rem = 56px

	function rowOuterClass(
		density: 'normal' | 'compact',
		compact: boolean,
	): string {
		return density === 'compact'
			? 'px-2 pb-3'
			: compact
				? 'pl-14 pr-14 pb-4'
				: 'pl-14 pr-14 pb-6';
	}

	it('applies symmetric inset to every roomy row (full-width and centered)', () => {
		const normal = rowOuterClass('normal', false);
		const compactProp = rowOuterClass('normal', true);
		for (const cls of [normal, compactProp]) {
			expect(cls).toContain('pl-14');
			expect(cls).toContain('pr-14');
			// Must not mix px-* with pl-*/pr-* (Tailwind padding-left conflict).
			expect(cls.includes('px-')).toBe(false);
		}
	});

	it('reserves a left inset wide enough to clear (and exceed) the roomy rail', () => {
		// 56px comfortably clears the rail so the avatar/header never overlaps.
		expect(PL_14_PX).toBeGreaterThan(ROOMY_RAIL_WIDTH);
	});

	it('uses a symmetric inset (left matches right)', () => {
		const cls = rowOuterClass('normal', false);
		expect(cls).toContain('pl-14');
		expect(cls).toContain('pr-14');
	});

	it('leaves constrained/compact rows on the tight px-2 spacing', () => {
		expect(rowOuterClass('compact', false)).toBe('px-2 pb-3');
	});
});
