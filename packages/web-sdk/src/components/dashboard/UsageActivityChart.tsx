import { useMemo, useState } from 'react';
import { Pin } from 'lucide-react';
import {
	ACCENT_CAST_BORDER,
	ACCENT_CAST_SHADOW,
	ACCENT_FILL,
	cn,
	NEO_EYEBROW,
	NEO_RADIUS,
	NeoSwatch,
	NeoTabs,
	type NeoAccent,
	type NeoTabOption,
} from './neopop';
import {
	formatAxisUsd,
	formatDayLabel,
	formatDayLong,
	formatNumber,
	formatUsd,
} from './format';
import { GROW_MS, GROW_TRANSITION, growDelay, useGrow } from './useGrow';
import type { UsageDay } from './useUsageDashboardData';

export type ChartMetric = 'cost' | 'tokens' | 'messages';

const METRIC_TABS: Array<NeoTabOption<ChartMetric>> = [
	{ value: 'cost', label: 'Cost', title: 'Token value at API rates' },
	{ value: 'tokens', label: 'Tokens', title: 'Input vs output tokens' },
	{ value: 'messages', label: 'Msgs', title: 'Assistant messages' },
];

/**
 * One fill colour per metric, the way the OttoRouter chart switches its
 * `currentColor`. Only tokens splits, into two clearly distinct accents —
 * the credential mix has its own panel and does not need to tint the chart.
 */
const METRIC_ACCENT: Record<ChartMetric, NeoAccent> = {
	cost: 'blue',
	tokens: 'blue',
	messages: 'lime',
};

interface Segment {
	key: string;
	label: string;
	accent: NeoAccent;
	value: number;
}

function segmentsFor(day: UsageDay, metric: ChartMetric): Segment[] {
	if (metric === 'tokens') {
		return [
			{
				key: 'output',
				label: 'output',
				accent: 'lime',
				value: day.outputTokens,
			},
			{ key: 'input', label: 'input', accent: 'blue', value: day.inputTokens },
		];
	}
	if (metric === 'messages') {
		return [
			{
				key: 'messages',
				label: 'messages',
				accent: 'lime',
				value: day.messages,
			},
		];
	}
	return [
		{ key: 'cost', label: 'value', accent: 'blue', value: day.notionalCostUsd },
	];
}

function totalFor(day: UsageDay, metric: ChartMetric): number {
	if (metric === 'tokens') return day.inputTokens + day.outputTokens;
	if (metric === 'messages') return day.messages;
	return day.notionalCostUsd;
}

/** The credential split behind a day, shown as text in the focus readout. */
function costDetail(day: UsageDay): string {
	const parts: string[] = [];
	if (day.notionalByAuth.api > 0)
		parts.push(`${formatUsd(day.notionalByAuth.api)} api`);
	if (day.notionalByAuth.oauth > 0)
		parts.push(`${formatUsd(day.notionalByAuth.oauth)} oauth`);
	if (day.notionalByAuth.subscription > 0)
		parts.push(`${formatUsd(day.notionalByAuth.subscription)} sub`);
	return parts.join(' · ');
}

function formatMetric(value: number, metric: ChartMetric): string {
	return metric === 'cost' ? formatUsd(value) : formatNumber(value);
}

function formatAxis(value: number, metric: ChartMetric): string {
	return metric === 'cost' ? formatAxisUsd(value) : formatNumber(value);
}

export interface UsageActivityChartProps {
	series: UsageDay[];
	metric: ChartMetric;
	onMetricChange: (metric: ChartMetric) => void;
}

export function UsageActivityChart({
	series,
	metric,
	onMetricChange,
}: UsageActivityChartProps) {
	const [hover, setHover] = useState<number | null>(null);
	const [pinned, setPinned] = useState<string | null>(null);
	const grown = useGrow(`${metric}:${series.length}:${series[0]?.date ?? ''}`);

	const max = useMemo(
		() => series.reduce((m, day) => Math.max(m, totalFor(day, metric)), 0),
		[series, metric],
	);

	const pinnedIndex = useMemo(
		() => (pinned ? series.findIndex((day) => day.date === pinned) : -1),
		[pinned, series],
	);

	if (series.length === 0) {
		return (
			<div className="flex h-48 items-center justify-center text-[12px] text-muted-foreground">
				No activity recorded yet
			</div>
		);
	}

	const focusIndex =
		hover ?? (pinnedIndex >= 0 ? pinnedIndex : series.length - 1);
	const focus = series[focusIndex] ?? series[series.length - 1];
	const focusTotal = totalFor(focus, metric);
	const focusDetail =
		metric === 'cost'
			? costDetail(focus)
			: segmentsFor(focus, metric)
					.filter((segment) => segment.value > 0)
					.map(
						(segment) =>
							`${formatMetric(segment.value, metric)} ${segment.label}`,
					)
					.join(' · ');

	const accent = METRIC_ACCENT[metric];
	// Past ~45 columns a bar is narrower than its own 2px edge, so the hard
	// extrusion is dropped and the bars render as flat ticks instead.
	const dense = series.length > 45;

	return (
		<div>
			<div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<div className="flex items-center gap-1.5">
						<h4 className={cn(NEO_EYEBROW, 'text-muted-foreground')}>
							{formatDayLong(focus.date)}
						</h4>
						{pinnedIndex >= 0 && (
							<Pin className="size-2.5 text-muted-foreground" />
						)}
					</div>
					<p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
						{formatMetric(focusTotal, metric)}
					</p>
					<p className="mt-1 min-h-4 text-[12px] text-muted-foreground tabular-nums">
						{focusDetail || 'idle day'}
					</p>
				</div>
				<NeoTabs
					aria-label="Chart metric"
					options={METRIC_TABS}
					value={metric}
					accent={accent}
					onChange={onMetricChange}
					className="self-start"
				/>
			</div>

			<div className="flex gap-2">
				<div className="flex w-12 shrink-0 flex-col justify-between py-px text-right text-[10px] tabular-nums text-muted-foreground">
					<span>{formatAxis(max, metric)}</span>
					<span>{formatAxis(max / 2, metric)}</span>
					<span>0</span>
				</div>
				<div className="relative h-48 min-w-0 flex-1 border-b-2 border-l-2 border-[rgb(var(--np-edge))] sm:h-56">
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0"
					>
						<div className="absolute inset-x-0 top-0 border-t-2 border-dashed border-[rgb(var(--np-edge)/0.3)]" />
						<div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-[rgb(var(--np-edge)/0.3)]" />
					</div>
					<div
						role="img"
						aria-label={`Daily ${metric} chart`}
						className={cn(
							'absolute inset-0 flex select-none items-end',
							dense ? 'gap-px' : 'gap-1',
						)}
					>
						{series.map((day, index) => {
							const total = totalFor(day, metric);
							const heightPct =
								max > 0 && total > 0 ? Math.max(2, (total / max) * 100) : 0;
							const active = index === focusIndex;
							const delay = growDelay(index, series.length);
							return (
								<button
									type="button"
									key={day.date}
									title={`${formatDayLong(day.date)} · ${formatMetric(
										total,
										metric,
									)}`}
									onMouseEnter={() => setHover(index)}
									onMouseLeave={() => setHover(null)}
									onFocus={() => setHover(index)}
									onBlur={() => setHover(null)}
									onClick={() =>
										setPinned((current) =>
											current === day.date ? null : day.date,
										)
									}
									className="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end"
								>
									{active && (
										<span
											aria-hidden="true"
											className="absolute inset-y-0 -inset-x-0.5 bg-muted/70"
										/>
									)}
									{total > 0 ? (
										<span
											className={cn(
												'relative flex w-full flex-col-reverse overflow-hidden rounded-t-[2px]',
												// The extrusion: cast-coloured stroke plus a hard drop
												// in the same deep shade, so the column reads as a
												// solid block standing off the plot.
												!dense &&
													cn(
														'border-2',
														ACCENT_CAST_BORDER[accent],
														ACCENT_CAST_SHADOW[accent],
													),
											)}
											style={{
												height: `${grown ? heightPct : 0}%`,
												transition: `height ${GROW_MS}ms ${GROW_TRANSITION} ${delay}ms`,
											}}
										>
											{segmentsFor(day, metric).map((segment) =>
												segment.value > 0 ? (
													<span
														key={segment.key}
														className={ACCENT_FILL[segment.accent]}
														style={{
															height: `${(segment.value / total) * 100}%`,
														}}
													/>
												) : null,
											)}
										</span>
									) : (
										<span
											aria-hidden="true"
											className="relative mx-auto h-[3px] w-full max-w-3 rounded-[1px] bg-[rgb(var(--np-edge)/0.6)]"
										/>
									)}
								</button>
							);
						})}
					</div>
				</div>
			</div>

			<div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pl-14 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
				<span>{formatDayLabel(series[0].date)}</span>
				{metric === 'tokens' ? (
					<span className="flex flex-wrap items-center gap-3">
						<NeoSwatch accent="blue" label="input" />
						<NeoSwatch accent="lime" label="output" />
					</span>
				) : (
					<span>hover a column · click to pin</span>
				)}
				<span>{formatDayLabel(series[series.length - 1].date)}</span>
			</div>
			<p
				className={cn(
					'mt-3 border-2 border-dashed border-[rgb(var(--np-edge)/0.4)] px-2.5 py-1.5',
					'text-[11px] text-muted-foreground',
					NEO_RADIUS,
				)}
			>
				{metric === 'cost'
					? 'Bars show token value at catalog API rates · the credential mix is broken out under “How you’re paying”'
					: 'Bars show daily totals for the selected range'}
			</p>
		</div>
	);
}
