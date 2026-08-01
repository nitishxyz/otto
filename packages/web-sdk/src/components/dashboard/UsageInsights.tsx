import { useMemo } from 'react';
import type { UsageStats } from '../../lib/api-client/usage';
import {
	ACCENT_TEXT,
	cn,
	NEO_EDGE,
	NEO_EYEBROW,
	NEO_RADIUS,
	type NeoAccent,
} from './neopop';
import {
	cacheAccent,
	cacheHitRate,
	formatDayLabel,
	formatNumber,
	formatPct,
	formatUsd,
} from './format';
import type { UsageDay } from './useUsageDashboardData';

interface Insight {
	key: string;
	label: string;
	value: string;
	hint: string;
	accent?: NeoAccent;
	title?: string;
}

export interface UsageInsightsProps {
	stats: UsageStats;
	series: UsageDay[];
	activeDays: number;
	rangeLabel: string;
}

/**
 * Derived context the raw aggregates do not spell out. Every figure is scoped
 * to the selected range, because the server aggregates the window rather than
 * lifetime activity.
 */
export function UsageInsights({
	stats,
	series,
	activeDays,
	rangeLabel,
}: UsageInsightsProps) {
	const insights = useMemo<Insight[]>(() => {
		const totals = stats.totals;
		const busiest = series.reduce<UsageDay | null>(
			(best, day) =>
				day.messages > 0 && (!best || day.messages > best.messages)
					? day
					: best,
			null,
		);
		const peakSpend = series.reduce<UsageDay | null>(
			(best, day) =>
				day.notionalCostUsd > 0 &&
				(!best || day.notionalCostUsd > best.notionalCostUsd)
					? day
					: best,
			null,
		);
		const perActiveDay =
			activeDays > 0 ? totals.notionalCostUsd / activeDays : 0;
		const perSession =
			totals.sessions > 0 ? totals.messages / totals.sessions : 0;
		const rangeTokens = totals.inputTokens + totals.outputTokens;
		const outputShare =
			rangeTokens > 0 ? (totals.outputTokens / rangeTokens) * 100 : 0;
		const cacheRate = cacheHitRate(totals);
		const window = rangeLabel.toLowerCase();

		return [
			{
				key: 'busiest',
				label: 'Busiest day',
				value: busiest ? formatDayLabel(busiest.date) : '—',
				hint: busiest
					? `${formatNumber(busiest.messages)} messages`
					: 'no activity',
				title: `Highest message count in the ${window}`,
			},
			{
				key: 'peak',
				label: 'Peak spend day',
				value: peakSpend ? formatUsd(peakSpend.notionalCostUsd) : '—',
				hint: peakSpend ? formatDayLabel(peakSpend.date) : 'no activity',
				accent: 'blue',
				title: `Highest token value at API rates in the ${window}`,
			},
			{
				key: 'per-day',
				label: 'Per active day',
				value: formatUsd(perActiveDay),
				hint: `${activeDays} of ${series.length} days used`,
				accent: 'blue',
				title: 'Token value averaged across days with activity',
			},
			{
				key: 'output-share',
				label: 'Output share',
				value: formatPct(outputShare),
				hint: `${formatNumber(totals.outputTokens)} generated tokens`,
				title: 'Share of tokens in this range produced by the model',
			},
			{
				key: 'cache',
				label: 'Cache reuse',
				value: cacheRate === null ? '—' : formatPct(cacheRate),
				hint: `${formatNumber(totals.cachedInputTokens)} tokens read`,
				accent: cacheRate === null ? undefined : cacheAccent(cacheRate),
				title: 'Share of prompt tokens served from the provider cache',
			},
			{
				key: 'sessions',
				label: 'Sessions',
				value: formatNumber(totals.sessions),
				hint: `${perSession.toFixed(1)} msgs each`,
				title: 'Sessions with activity in this range',
			},
			{
				key: 'reasoning',
				label: 'Reasoning',
				value: formatNumber(totals.reasoningTokens),
				hint: 'thinking tokens',
				title: 'Tokens spent on reasoning traces',
			},
			{
				key: 'cache-writes',
				label: 'Cache writes',
				value: formatNumber(totals.cacheCreationInputTokens),
				hint: 'tokens written to cache',
				title: 'Prompt tokens billed to populate the provider cache',
			},
		];
	}, [series, stats, activeDays, rangeLabel]);

	return (
		<ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
			{insights.map((insight) => (
				<li
					key={insight.key}
					title={insight.title}
					className={cn('min-w-0 bg-card px-3.5 py-3', NEO_RADIUS, NEO_EDGE)}
				>
					<p className={cn(NEO_EYEBROW, 'text-muted-foreground')}>
						{insight.label}
					</p>
					<p
						className={cn(
							'mt-2 truncate text-[17px] font-semibold leading-none tracking-tight tabular-nums',
							insight.accent ? ACCENT_TEXT[insight.accent] : 'text-foreground',
						)}
					>
						{insight.value}
					</p>
					<p className="mt-1.5 truncate text-[11px] text-muted-foreground tabular-nums">
						{insight.hint}
					</p>
				</li>
			))}
		</ul>
	);
}
