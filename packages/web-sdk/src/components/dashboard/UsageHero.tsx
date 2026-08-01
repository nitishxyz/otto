import type { ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { UsageStats } from '../../lib/api-client/usage';
import {
	ACCENT_CAST_BORDER,
	ACCENT_FILL,
	ACCENT_TEXT,
	cn,
	NEO_RADIUS,
	NeoBadge,
	NeoEyebrow,
	NeoPanel,
	type NeoAccent,
} from './neopop';
import {
	deltaPct,
	formatDayLabel,
	formatDelta,
	formatNumber,
	formatUsd,
} from './format';
import { GROW_MS, GROW_TRANSITION, growDelay, useGrow } from './useGrow';
import type { UsageDay, UsageTotals } from './useUsageDashboardData';

/** Direction is semantic, not numeric: more spend is not automatically good. */
export function DeltaBadge({
	current,
	previous,
	invert = false,
}: {
	current: number;
	previous: number | null;
	invert?: boolean;
}) {
	if (previous === null) return null;
	const pct = deltaPct(current, previous);
	if (pct === null) return null;
	const flat = Math.abs(pct) < 1;
	const up = pct > 0;
	const good = flat ? false : invert ? !up : up;
	const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
	return (
		<NeoBadge
			outline
			accent={flat ? 'blue' : good ? 'lime' : 'coral'}
			title="Compared with the preceding period of equal length"
		>
			<Icon className="size-2.5" />
			{flat ? 'flat' : formatDelta(pct)}
		</NeoBadge>
	);
}

/**
 * Compressed range preview. Bars are extruded like the main chart but with a
 * single-edge cast, so the strip stays legible at 90+ columns.
 */
function Sparkline({
	series,
	accent,
}: {
	series: UsageDay[];
	accent: NeoAccent;
}) {
	const grown = useGrow(`${series.length}:${series[0]?.date ?? ''}`);
	const max = series.reduce((m, day) => Math.max(m, day.notionalCostUsd), 0);
	if (series.length === 0) return null;
	return (
		<div
			aria-hidden="true"
			className={cn(
				'flex h-16 items-end gap-px overflow-hidden border-2 border-[rgb(var(--np-edge))] bg-background px-1.5 pb-1.5 pt-2',
				NEO_RADIUS,
			)}
		>
			{series.map((day, index) => {
				const active = day.notionalCostUsd > 0;
				const pct =
					max > 0 && active
						? Math.max(6, (day.notionalCostUsd / max) * 100)
						: 2;
				return (
					<span
						key={day.date}
						className={cn(
							'min-w-px flex-1',
							active
								? cn(
										ACCENT_FILL[accent],
										ACCENT_CAST_BORDER[accent],
										'border-t-2',
									)
								: 'bg-muted-foreground/30',
						)}
						style={{
							height: `${grown ? pct : 0}%`,
							transition: `height ${GROW_MS}ms ${GROW_TRANSITION} ${growDelay(
								index,
								series.length,
							)}ms`,
						}}
					/>
				);
			})}
		</div>
	);
}

export interface StatTileProps {
	label: string;
	value: string;
	hint: ReactNode;
	/** Colours the value only; the tile itself stays neutral. */
	accent?: NeoAccent;
	action?: ReactNode;
}

/** Headline metric tile: neutral surface, hard drop, accented number. */
export function StatTile({
	label,
	value,
	hint,
	accent,
	action,
}: StatTileProps) {
	return (
		<NeoPanel elevation="sm" className="flex min-w-0 flex-col gap-1.5 p-4">
			<div className="flex items-start justify-between gap-3">
				<NeoEyebrow>{label}</NeoEyebrow>
				{action}
			</div>
			<p
				className={cn(
					'truncate text-[26px] font-semibold leading-none tracking-tight tabular-nums',
					accent ? ACCENT_TEXT[accent] : 'text-foreground',
				)}
			>
				{value}
			</p>
			<p className="text-[11px] leading-snug text-muted-foreground tabular-nums">
				{hint}
			</p>
		</NeoPanel>
	);
}

export interface UsageHeroProps {
	totals: UsageStats['totals'];
	previous: UsageTotals | null;
	series: UsageDay[];
	activeDays: number;
	rangeLabel: string;
}

export function UsageHero({
	totals,
	previous,
	series,
	activeDays,
	rangeLabel,
}: UsageHeroProps) {
	const first = series[0]?.date;
	const last = series[series.length - 1]?.date;
	const totalTokens = totals.inputTokens + totals.outputTokens;
	const perMessage =
		totals.messages > 0 ? totals.notionalCostUsd / totals.messages : 0;

	return (
		<div className="space-y-4">
			<NeoPanel
				elevation="sm"
				className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)] md:items-center md:p-6"
			>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<NeoEyebrow>Token value · API rates</NeoEyebrow>
						<DeltaBadge
							current={totals.notionalCostUsd}
							previous={previous?.notionalCostUsd ?? null}
							invert
						/>
					</div>
					<p className="mt-2.5 text-4xl font-semibold tracking-tight tabular-nums text-[rgb(var(--np-blue))] sm:text-5xl">
						{formatUsd(totals.notionalCostUsd)}
					</p>
					<p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground tabular-nums">
						{rangeLabel.toLowerCase()} · {formatNumber(totals.messages)}{' '}
						messages valued at catalog pricing · {formatUsd(perMessage)} per
						message
					</p>
				</div>
				<div className="min-w-0">
					<Sparkline series={series} accent="blue" />
					{first && last && (
						<div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
							<span>{formatDayLabel(first)}</span>
							<span>{activeDays} active days</span>
							<span>{formatDayLabel(last)}</span>
						</div>
					)}
				</div>
			</NeoPanel>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<StatTile
					label="Actually paid"
					value={formatUsd(totals.costUsd)}
					hint="pay-as-you-go, billed per token"
					action={
						<DeltaBadge
							current={totals.costUsd}
							previous={previous?.costUsd ?? null}
							invert
						/>
					}
				/>
				<StatTile
					label="Covered by plans"
					value={formatUsd(totals.savedUsd)}
					hint="OAuth & subscription value not billed per token"
					accent="lime"
				/>
				<StatTile
					label="Tokens"
					value={formatNumber(totalTokens)}
					hint={`${formatNumber(totals.inputTokens)} in · ${formatNumber(
						totals.outputTokens,
					)} out`}
					action={
						<DeltaBadge
							current={totalTokens}
							previous={
								previous ? previous.inputTokens + previous.outputTokens : null
							}
						/>
					}
				/>
			</div>
		</div>
	);
}
