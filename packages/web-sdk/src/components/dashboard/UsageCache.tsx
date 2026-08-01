import { useMemo } from 'react';
import { ProviderLogo } from '../common/ProviderLogo';
import type { UsageStats } from '../../lib/api-client/usage';
import {
	ACCENT_FILL,
	ACCENT_TEXT,
	cn,
	NEO_EYEBROW,
	NEO_RADIUS,
	NeoEmptyState,
	type NeoAccent,
} from './neopop';
import {
	cacheAccent,
	cacheHitRate,
	formatNumber,
	formatPct,
	promptTokens,
} from './format';
import { GROW_MS, GROW_TRANSITION, growDelay, useGrow } from './useGrow';

interface CacheRow {
	provider: string;
	rate: number;
	accent: NeoAccent;
	cached: number;
	written: number;
	uncached: number;
	prompt: number;
}

export interface UsageCacheProps {
	stats: UsageStats;
	/** Replays the grow-in when the scope or range changes. */
	resetKey?: string;
}

/**
 * Cache efficiency per provider. `inputTokens` is stored exclusive of cache
 * reads and writes, so the hit rate is cache reads over the full prompt —
 * the share of prompt tokens that were billed at the cheaper cached rate.
 */
export function UsageCache({ stats, resetKey }: UsageCacheProps) {
	const grown = useGrow(resetKey);

	const rows = useMemo<CacheRow[]>(() => {
		return stats.providers
			.map((provider) => {
				const rate = cacheHitRate(provider);
				if (rate === null) return null;
				return {
					provider: provider.provider,
					rate,
					accent: cacheAccent(rate),
					cached: provider.cachedInputTokens,
					written: provider.cacheCreationInputTokens,
					uncached: provider.inputTokens,
					prompt: promptTokens(provider),
				} satisfies CacheRow;
			})
			.filter((row): row is CacheRow => row !== null)
			.sort((a, b) => b.prompt - a.prompt);
	}, [stats.providers]);

	const overall = useMemo(() => cacheHitRate(stats.totals), [stats.totals]);

	if (rows.length === 0) {
		return (
			<NeoEmptyState>No prompt tokens recorded in this range</NeoEmptyState>
		);
	}

	return (
		<div>
			{overall !== null && (
				<div className="mb-4 flex items-baseline justify-between gap-3">
					<div>
						<span className={cn(NEO_EYEBROW, 'text-muted-foreground')}>
							Combined hit rate
						</span>
						<p
							className={cn(
								'mt-1.5 text-2xl font-semibold leading-none tracking-tight tabular-nums',
								ACCENT_TEXT[cacheAccent(overall)],
							)}
						>
							{formatPct(overall)}
						</p>
					</div>
					<p className="text-right text-[11px] leading-snug text-muted-foreground tabular-nums">
						{formatNumber(stats.totals.cachedInputTokens)} of{' '}
						{formatNumber(promptTokens(stats.totals))} prompt tokens
						<br />
						served from cache
					</p>
				</div>
			)}

			<ul className="space-y-1.5">
				{rows.map((row, index) => (
					<li key={row.provider} className="px-0.5 py-1.5">
						<div className="flex items-center gap-2.5">
							<span
								className={cn(
									'flex size-7 shrink-0 items-center justify-center border-2 border-[rgb(var(--np-edge))] bg-background',
									NEO_RADIUS,
								)}
							>
								<ProviderLogo provider={row.provider} size={15} />
							</span>
							<div className="min-w-0 flex-1">
								<p className="truncate text-[13px] font-medium leading-tight">
									{row.provider}
								</p>
								<p className="mt-0.5 truncate text-[11px] leading-tight tabular-nums text-muted-foreground">
									{formatNumber(row.cached)} read · {formatNumber(row.written)}{' '}
									written · {formatNumber(row.uncached)} fresh
								</p>
							</div>
							<p
								className={cn(
									'shrink-0 text-[13px] font-semibold tabular-nums',
									ACCENT_TEXT[row.accent],
								)}
							>
								{formatPct(row.rate)}
							</p>
						</div>
						<div
							className={cn(
								'mt-2 h-2 w-full overflow-hidden border-2 border-[rgb(var(--np-edge))] bg-background',
								NEO_RADIUS,
							)}
						>
							<div
								className={cn('h-full', ACCENT_FILL[row.accent])}
								style={{
									width: `${grown ? Math.min(100, row.rate) : 0}%`,
									transition: `width ${GROW_MS}ms ${GROW_TRANSITION} ${growDelay(
										index,
										rows.length,
									)}ms`,
								}}
							/>
						</div>
					</li>
				))}
			</ul>

			<p
				className={cn(
					'mt-4 border-2 border-dashed border-[rgb(var(--np-edge)/0.4)] px-3 py-2',
					'text-[11px] leading-relaxed text-muted-foreground',
					NEO_RADIUS,
				)}
			>
				Hit rate is cache reads over all prompt tokens. Providers that do not
				report cache usage are omitted.
			</p>
		</div>
	);
}
