import { describe, expect, test } from 'bun:test';
import {
	bucketForTimestamp,
	resolveUsageRange,
} from '../packages/server/src/routes/usage/range.ts';

const NOON = new Date(2026, 6, 15, 12, 0, 0);

function at(year: number, month: number, day: number, hour = 12): number {
	return new Date(year, month, day, hour).getTime();
}

describe('resolveUsageRange', () => {
	test('returns undefined for all-time', () => {
		expect(resolveUsageRange(undefined, NOON)).toBeUndefined();
		expect(resolveUsageRange(0, NOON)).toBeUndefined();
	});

	test('anchors the window to local midnight and includes today', () => {
		const range = resolveUsageRange(7, NOON);
		expect(range).toBeDefined();
		// 7 days ending today (the 15th) starts on the 9th at 00:00 local.
		expect(new Date(range?.sinceMs ?? 0)).toEqual(new Date(2026, 6, 9));
		// The preceding 7-day window starts on the 2nd.
		expect(new Date(range?.previousSinceMs ?? 0)).toEqual(new Date(2026, 6, 2));
	});

	test('a single-day range covers only today', () => {
		const range = resolveUsageRange(1, NOON);
		expect(new Date(range?.sinceMs ?? 0)).toEqual(new Date(2026, 6, 15));
		expect(new Date(range?.previousSinceMs ?? 0)).toEqual(
			new Date(2026, 6, 14),
		);
	});
});

describe('bucketForTimestamp', () => {
	const range = resolveUsageRange(7, NOON);

	test('everything is current when there is no range', () => {
		expect(bucketForTimestamp(at(2001, 0, 1), undefined)).toBe('current');
	});

	test('classifies the three windows', () => {
		// Today and the start of the window are current.
		expect(bucketForTimestamp(at(2026, 6, 15), range)).toBe('current');
		expect(bucketForTimestamp(at(2026, 6, 9, 0), range)).toBe('current');
		// The day before the window opens belongs to the prior period.
		expect(bucketForTimestamp(at(2026, 6, 8, 23), range)).toBe('previous');
		expect(bucketForTimestamp(at(2026, 6, 2, 0), range)).toBe('previous');
		// Anything older falls out entirely.
		expect(bucketForTimestamp(at(2026, 6, 1, 23), range)).toBe('outside');
	});

	test('the two windows are the same length and do not overlap', () => {
		const days = new Set<string>();
		for (let day = 2; day <= 15; day += 1) {
			days.add(`${day}:${bucketForTimestamp(at(2026, 6, day), range)}`);
		}
		const current = [...days].filter((d) => d.endsWith('current'));
		const previous = [...days].filter((d) => d.endsWith('previous'));
		expect(current).toHaveLength(7);
		expect(previous).toHaveLength(7);
	});
});
