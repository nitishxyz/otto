/**
 * Range helpers for the usage endpoints.
 *
 * Windows are aligned to local midnight so they line up with the `daily`
 * buckets, which are keyed by the local calendar date.
 */

export interface UsageRange {
	/** Number of whole days in the window, including today. */
	days: number;
	/** Inclusive start of the selected window, epoch ms. */
	sinceMs: number;
	/** Inclusive start of the preceding window of equal length, epoch ms. */
	previousSinceMs: number;
}

function startOfLocalDay(date: Date): Date {
	const copy = new Date(date);
	copy.setHours(0, 0, 0, 0);
	return copy;
}

/**
 * `setDate` is used rather than subtracting milliseconds so a window that
 * spans a DST transition still covers the intended number of calendar days.
 */
function shiftDays(date: Date, delta: number): Date {
	const copy = new Date(date);
	copy.setDate(copy.getDate() + delta);
	return copy;
}

/**
 * Resolves the `days` query parameter into a concrete window. Returns
 * `undefined` for all-time, which skips every date filter.
 */
export function resolveUsageRange(
	days: number | undefined,
	now: Date = new Date(),
): UsageRange | undefined {
	if (!days || !Number.isFinite(days) || days <= 0) return undefined;
	const today = startOfLocalDay(now);
	const since = shiftDays(today, -(days - 1));
	const previousSince = shiftDays(since, -days);
	return {
		days,
		sinceMs: since.getTime(),
		previousSinceMs: previousSince.getTime(),
	};
}

export type RangeBucket = 'current' | 'previous' | 'outside';

/** Classifies a message timestamp against the selected window. */
export function bucketForTimestamp(
	timestamp: number,
	range: UsageRange | undefined,
): RangeBucket {
	if (!range) return 'current';
	if (timestamp >= range.sinceMs) return 'current';
	if (timestamp >= range.previousSinceMs) return 'previous';
	return 'outside';
}
