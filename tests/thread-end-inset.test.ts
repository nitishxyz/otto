import { describe, expect, test } from 'bun:test';
import {
	THREAD_END_BREATHING_ROOM_PX,
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
});
