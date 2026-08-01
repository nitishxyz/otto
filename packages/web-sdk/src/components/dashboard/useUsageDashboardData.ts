import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api-client';
import type { UsageStats } from '../../lib/api-client/usage';

export type UsageScope = 'project' | 'global';

export const RANGE_OPTIONS = [
	{ value: '7', label: '7D', days: 7, title: 'Last 7 days' },
	{ value: '30', label: '30D', days: 30, title: 'Last 30 days' },
	{ value: '90', label: '90D', days: 90, title: 'Last 90 days' },
	{ value: 'all', label: 'ALL', days: 0, title: 'All recorded activity' },
] as const;

export type UsageRangeKey = (typeof RANGE_OPTIONS)[number]['value'];

export type UsageDay = UsageStats['daily'][number];
export type UsageTotals = UsageStats['totals'];

function emptyDay(date: string): UsageDay {
	return {
		date,
		messages: 0,
		inputTokens: 0,
		outputTokens: 0,
		costUsd: 0,
		notionalCostUsd: 0,
		costByAuth: { oauth: 0, api: 0, subscription: 0 },
		notionalByAuth: { oauth: 0, api: 0, subscription: 0 },
	};
}

function dayKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function fromKey(key: string): Date {
	const [y, m, d] = key.split('-').map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function shiftDays(date: Date, delta: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + delta);
	return next;
}

/**
 * Expands the sparse daily rows the server returns into a gap-free series, so
 * idle days read as gaps in the chart instead of silently collapsing the
 * timeline. For a bounded range the window is anchored to today even when the
 * leading or trailing days had no activity.
 */
function buildSeries(daily: UsageDay[], days: number): UsageDay[] {
	if (days <= 0) {
		if (daily.length === 0) return [];
		const byDate = new Map(daily.map((day) => [day.date, day]));
		const series: UsageDay[] = [];
		const end = fromKey(daily[daily.length - 1].date);
		for (
			let cursor = fromKey(daily[0].date);
			cursor <= end;
			cursor = shiftDays(cursor, 1)
		) {
			const key = dayKey(cursor);
			series.push(byDate.get(key) ?? emptyDay(key));
		}
		return series;
	}

	const byDate = new Map(daily.map((day) => [day.date, day]));
	const end = fromKey(dayKey(new Date()));
	const series: UsageDay[] = [];
	for (let offset = days - 1; offset >= 0; offset -= 1) {
		const key = dayKey(shiftDays(end, -offset));
		series.push(byDate.get(key) ?? emptyDay(key));
	}
	return series;
}

/** Days in the range that saw at least one message. */
function countActiveDays(series: UsageDay[]): number {
	return series.reduce((count, day) => count + (day.messages > 0 ? 1 : 0), 0);
}

export interface UsageDashboardData {
	stats: UsageStats | null;
	loading: boolean;
	error: string | null;
	scope: UsageScope;
	setScope: (scope: UsageScope) => void;
	rangeKey: UsageRangeKey;
	setRangeKey: (key: UsageRangeKey) => void;
	rangeLabel: string;
	/** Gap-free daily series covering the selected window. */
	series: UsageDay[];
	activeDays: number;
	/** Server totals for the preceding window of equal length, if bounded. */
	previous: UsageTotals | null;
	refresh: () => void;
	scopeLabel: string;
}

/**
 * Loads usage stats for the selected scope and range. The range is applied
 * server-side, so every aggregate — totals, providers, models, daily — covers
 * exactly the selected window rather than lifetime activity.
 */
export function useUsageDashboardData(): UsageDashboardData {
	const [stats, setStats] = useState<UsageStats | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [scope, setScopeState] = useState<UsageScope>('project');
	const [rangeKey, setRangeKey] = useState<UsageRangeKey>('30');

	const days = useMemo(
		() => RANGE_OPTIONS.find((option) => option.value === rangeKey)?.days ?? 0,
		[rangeKey],
	);

	const fetchStats = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const options = days > 0 ? { days } : {};
			const data =
				scope === 'global'
					? await apiClient.getGlobalUsageStats(options)
					: await apiClient.getUsageStats(options);
			setStats(data);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to load usage stats');
		} finally {
			setLoading(false);
		}
	}, [scope, days]);

	useEffect(() => {
		void fetchStats();
	}, [fetchStats]);

	const setScope = useCallback((next: UsageScope) => {
		setScopeState(next);
		setStats(null);
		setError(null);
	}, []);

	const series = useMemo(
		() => buildSeries(stats?.daily ?? [], days),
		[stats?.daily, days],
	);

	const activeDays = useMemo(() => countActiveDays(series), [series]);

	const rangeLabel = useMemo(() => {
		const option = RANGE_OPTIONS.find((item) => item.value === rangeKey);
		if (!option || option.days === 0) return 'All time';
		return `Last ${option.days} days`;
	}, [rangeKey]);

	const scopeLabel = useMemo(() => {
		if (scope === 'global') {
			const included = stats?.projects?.included.length ?? 0;
			const unavailable = stats?.projects?.unavailable.length ?? 0;
			const total = included + unavailable;
			if (total === 0) return 'all projects';
			return unavailable > 0
				? `${included} of ${total} projects`
				: `${total} project${total === 1 ? '' : 's'}`;
		}
		if (!stats?.project) return '';
		const parts = stats.project.split('/').filter(Boolean);
		return parts[parts.length - 1] ?? stats.project;
	}, [scope, stats?.project, stats?.projects]);

	const refresh = useCallback(() => {
		void fetchStats();
	}, [fetchStats]);

	return {
		stats,
		loading,
		error,
		scope,
		setScope,
		rangeKey,
		setRangeKey,
		rangeLabel,
		series,
		activeDays,
		previous: stats?.previousTotals ?? null,
		refresh,
		scopeLabel,
	};
}
