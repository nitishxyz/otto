import { describe, expect, test } from 'bun:test';
import {
	THREAD_END_BREATHING_ROOM_COMPACT_PX,
	THREAD_END_BREATHING_ROOM_PX,
	getThreadEndBreathingRoom,
	resolveThreadEndInset,
} from '../packages/web-sdk/src/components/messages/threadEndInset';

describe('thread end inset', () => {
	test('adds breathing room on top of the measured composer overlap', () => {
		expect(resolveThreadEndInset(150)).toBe(150 + THREAD_END_BREATHING_ROOM_PX);
	});

	test('tracks composer growth (multiline input, session bars)', () => {
		const collapsed = resolveThreadEndInset(120);
		const expanded = resolveThreadEndInset(260);
		expect(expanded - collapsed).toBe(140);
	});

	test('falls back to breathing room when no composer overlaps', () => {
		expect(resolveThreadEndInset(0)).toBe(THREAD_END_BREATHING_ROOM_PX);
	});

	test('treats negative or non-finite overlap as no overlap', () => {
		expect(resolveThreadEndInset(-40)).toBe(THREAD_END_BREATHING_ROOM_PX);
		expect(resolveThreadEndInset(Number.NaN)).toBe(
			THREAD_END_BREATHING_ROOM_PX,
		);
		expect(resolveThreadEndInset(Number.POSITIVE_INFINITY)).toBe(
			THREAD_END_BREATHING_ROOM_PX,
		);
	});

	test('rounds fractional measurements so the inset cannot oscillate', () => {
		expect(resolveThreadEndInset(150.4)).toBe(
			Math.round(150.4 + THREAD_END_BREATHING_ROOM_PX),
		);
		expect(resolveThreadEndInset(150.6)).toBe(
			Math.round(150.6 + THREAD_END_BREATHING_ROOM_PX),
		);
	});

	test('sanitizes a custom breathing room', () => {
		expect(resolveThreadEndInset(100, 0)).toBe(100);
		expect(resolveThreadEndInset(100, -10)).toBe(100);
		expect(resolveThreadEndInset(100, Number.NaN)).toBe(100);
	});

	test('clears the composer gradient fade in roomy density', () => {
		// The floating composer draws a 64px gradient (`pt-16`) above its
		// boundary; the roomy breathing room must be at least that tall so the
		// last row is visibly separated instead of flush under the fade.
		expect(getThreadEndBreathingRoom('normal')).toBeGreaterThanOrEqual(64);
	});

	test('uses a tighter but still visible gap in compact density', () => {
		const compactRoom = getThreadEndBreathingRoom('compact');
		expect(compactRoom).toBe(THREAD_END_BREATHING_ROOM_COMPACT_PX);
		expect(compactRoom).toBeGreaterThanOrEqual(40);
		expect(compactRoom).toBeLessThan(getThreadEndBreathingRoom('normal'));
	});

	test('density-resolved room flows through the inset unchanged', () => {
		expect(
			resolveThreadEndInset(180, getThreadEndBreathingRoom('normal')),
		).toBe(180 + THREAD_END_BREATHING_ROOM_PX);
		expect(
			resolveThreadEndInset(180, getThreadEndBreathingRoom('compact')),
		).toBe(180 + THREAD_END_BREATHING_ROOM_COMPACT_PX);
	});
});
