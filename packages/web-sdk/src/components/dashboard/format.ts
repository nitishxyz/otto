import type { NeoAccent } from './neopop';

export function formatNumber(n: number): string {
	if (!Number.isFinite(n) || n === 0) return '0';
	if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
	if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return n.toLocaleString();
}

export function formatUsd(n: number): string {
	if (!Number.isFinite(n) || n === 0) return '$0';
	if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
	if (Math.abs(n) < 1) return `$${n.toFixed(3)}`;
	if (Math.abs(n) < 100) return `$${n.toFixed(2)}`;
	if (Math.abs(n) < 10_000) return `$${n.toFixed(0)}`;
	return `$${formatNumber(n)}`;
}

/** Tight axis label — never wider than five glyphs. */
export function formatAxisUsd(n: number): string {
	if (!Number.isFinite(n) || n === 0) return '$0';
	if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
	if (Math.abs(n) >= 10) return `$${n.toFixed(0)}`;
	if (Math.abs(n) >= 1) return `$${n.toFixed(1)}`;
	return `$${n.toFixed(2)}`;
}

export function formatPct(n: number): string {
	if (!Number.isFinite(n)) return '0%';
	if (n > 0 && n < 1) return '<1%';
	return `${Math.round(n)}%`;
}

/** `2026-03-04` -> `Mar 4`. Parsed as a local date so no timezone drift. */
export function formatDayLabel(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return new Date(y, m - 1, d).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
	});
}

export function formatDayLong(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return new Date(y, m - 1, d).toLocaleDateString(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
	});
}

export type AuthBucket = 'api' | 'oauth' | 'subscription';

export const AUTH_LABEL: Record<AuthBucket, string> = {
	api: 'API key',
	oauth: 'OAuth',
	subscription: 'Subscription',
};

/**
 * Blue = metered spend, lime = covered by an OAuth plan, yellow = flat-rate
 * subscription. Coral stays reserved for errors and regressions.
 */
export const AUTH_ACCENT: Record<AuthBucket, NeoAccent> = {
	api: 'blue',
	oauth: 'lime',
	subscription: 'yellow',
};

export const AUTH_BUCKETS: AuthBucket[] = ['api', 'oauth', 'subscription'];

/** Provider/model `authType` values collapse into the three billing buckets. */
export function bucketOf(authType: string): AuthBucket {
	if (authType === 'oauth') return 'oauth';
	if (authType === 'subscription' || authType === 'wallet')
		return 'subscription';
	return 'api';
}

export function authTag(authType: string): string {
	if (authType === 'oauth') return 'oauth';
	if (authType === 'subscription') return 'sub';
	if (authType === 'wallet') return 'wallet';
	if (authType === 'api') return 'api';
	return '—';
}

/**
 * Prompt-token counts, split the way the server stores them: `inputTokens`
 * excludes cache reads and cache writes, so the three add up to the full
 * prompt.
 */
export interface CacheCounts {
	inputTokens: number;
	cachedInputTokens: number;
	cacheCreationInputTokens: number;
}

/** Total prompt tokens, cached and uncached. */
export function promptTokens(counts: CacheCounts): number {
	return (
		counts.inputTokens +
		counts.cachedInputTokens +
		counts.cacheCreationInputTokens
	);
}

/**
 * Share of prompt tokens served from the provider cache, as a percentage.
 * Returns `null` when there were no prompt tokens at all, which is distinct
 * from a genuine 0% hit rate.
 */
export function cacheHitRate(counts: CacheCounts): number | null {
	const total = promptTokens(counts);
	if (total <= 0) return null;
	return (counts.cachedInputTokens / total) * 100;
}

/** Warm caches are good, so the scale runs coral → yellow → lime. */
export function cacheAccent(rate: number): NeoAccent {
	if (rate >= 50) return 'lime';
	if (rate >= 20) return 'yellow';
	return 'coral';
}

/** Signed percentage change, or `null` when the baseline is empty. */
export function deltaPct(current: number, previous: number): number | null {
	if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
	if (previous <= 0) return current > 0 ? null : 0;
	return ((current - previous) / previous) * 100;
}

export function formatDelta(pct: number): string {
	const rounded =
		Math.abs(pct) >= 10 ? Math.round(pct) : Number(pct.toFixed(1));
	return `${rounded > 0 ? '+' : ''}${rounded}%`;
}
