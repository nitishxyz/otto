import { useMemo } from 'react';
import type { UsageStats } from '../../lib/api-client/usage';
import {
	ACCENT_CAST_BORDER,
	ACCENT_FILL,
	ACCENT_TEXT,
	cn,
	NEO_EDGE,
	NEO_RADIUS,
} from './neopop';
import {
	AUTH_ACCENT,
	AUTH_BUCKETS,
	AUTH_LABEL,
	bucketOf,
	formatPct,
	formatUsd,
	type AuthBucket,
} from './format';
import { GROW_MS, GROW_TRANSITION, growDelay, useGrow } from './useGrow';

export interface UsagePaymentSplitProps {
	stats: UsageStats;
	/** Replays the grow-in when the scope or range changes. */
	resetKey?: string;
}

/**
 * Where the money went in the selected range. Values are notional (catalog API
 * pricing) so flat-rate plans can be compared against pay-as-you-go on the same
 * axis; each row names the providers behind that credential type.
 */
export function UsagePaymentSplit({ stats, resetKey }: UsagePaymentSplitProps) {
	const grown = useGrow(resetKey);

	const providersByBucket = useMemo(() => {
		const map: Record<AuthBucket, string[]> = {
			api: [],
			oauth: [],
			subscription: [],
		};
		for (const provider of stats.providers) {
			map[bucketOf(provider.authType)].push(provider.provider);
		}
		return map;
	}, [stats.providers]);

	// Notional cost per credential type is not in `totals`, so it is summed from
	// the provider aggregates — both already cover exactly the selected range.
	const notionalByAuth = useMemo(() => {
		const map: Record<AuthBucket, number> = {
			api: 0,
			oauth: 0,
			subscription: 0,
		};
		for (const provider of stats.providers) {
			map[bucketOf(provider.authType)] += provider.notionalCostUsd;
		}
		return map;
	}, [stats.providers]);

	const total = AUTH_BUCKETS.reduce(
		(sum, bucket) => sum + notionalByAuth[bucket],
		0,
	);

	const rows = AUTH_BUCKETS.map((bucket) => ({
		bucket,
		value: notionalByAuth[bucket],
		pct: total > 0 ? (notionalByAuth[bucket] / total) * 100 : 0,
		providers: providersByBucket[bucket],
	})).sort((a, b) => b.value - a.value);

	if (total === 0) {
		return (
			<p className="py-6 text-center text-[12px] text-muted-foreground">
				Nothing recorded in this range
			</p>
		);
	}

	return (
		<div>
			<div
				className={cn(
					'flex h-4 w-full overflow-hidden bg-background',
					NEO_RADIUS,
					NEO_EDGE,
				)}
			>
				{rows
					.filter((row) => row.pct > 0)
					.map((row, index) => (
						<div
							key={row.bucket}
							className={ACCENT_FILL[AUTH_ACCENT[row.bucket]]}
							style={{
								width: `${grown ? row.pct : 0}%`,
								transition: `width ${GROW_MS}ms ${GROW_TRANSITION} ${growDelay(
									index,
									rows.length,
								)}ms`,
							}}
						/>
					))}
			</div>
			<ul className="mt-4 divide-y-2 divide-[rgb(var(--np-edge)/0.4)]">
				{rows.map((row) => (
					<li
						key={row.bucket}
						className={cn(
							'flex items-center gap-3 py-2.5',
							row.value === 0 && 'opacity-55',
						)}
					>
						<span
							className={cn(
								'size-3 shrink-0 border-2',
								ACCENT_FILL[AUTH_ACCENT[row.bucket]],
								ACCENT_CAST_BORDER[AUTH_ACCENT[row.bucket]],
							)}
						/>
						<div className="min-w-0 flex-1">
							<p className="text-[13px] font-medium leading-tight">
								{AUTH_LABEL[row.bucket]}
							</p>
							<p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
								{row.providers.length > 0
									? row.providers.join(' · ')
									: 'no provider connected'}
							</p>
						</div>
						<div className="shrink-0 text-right tabular-nums">
							<p
								className={cn(
									'text-[13px] font-semibold leading-tight',
									ACCENT_TEXT[AUTH_ACCENT[row.bucket]],
								)}
							>
								{formatUsd(row.value)}
							</p>
							<p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
								{formatPct(row.pct)}
							</p>
						</div>
					</li>
				))}
			</ul>
			<p
				className={cn(
					'mt-4 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground',
					NEO_RADIUS,
					NEO_EDGE,
					'border-dashed',
				)}
			>
				OAuth and subscription rows are flat-rate: the figure is what those
				tokens would have cost on pay-as-you-go API pricing, not an invoice.
			</p>
		</div>
	);
}
