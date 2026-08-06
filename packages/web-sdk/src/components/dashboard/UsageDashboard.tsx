import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Globe2, RefreshCw, X } from 'lucide-react';
import { ProviderLogo } from '../common/ProviderLogo';
import {
	cn,
	NEO_EYEBROW,
	NEO_RADIUS,
	NEO_SCOPE,
	NeoBadge,
	NeoIconButton,
	NeoPanel,
	NeoTabs,
	type NeoTabOption,
} from './neopop';
import {
	authTag,
	cacheHitRate,
	formatNumber,
	formatPct,
	formatUsd,
} from './format';
import {
	RANGE_OPTIONS,
	useUsageDashboardData,
	type UsageRangeKey,
	type UsageScope,
} from './useUsageDashboardData';
import { UsageCache } from './UsageCache';
import { UsageHero } from './UsageHero';
import { UsageInsights } from './UsageInsights';
import { UsageSection } from './UsageSection';
import { UsagePaymentSplit } from './UsagePaymentSplit';
import { UsageProjects } from './UsageProjects';
import { UsageSkeleton } from './UsageSkeleton';
import { BreakdownList, type BreakdownItem } from './UsageBreakdown';
import { UsageActivityChart, type ChartMetric } from './UsageActivityChart';

export interface UsageDashboardProps {
	onBack?: () => void;
}

type ModelSort = 'cost' | 'tokens' | 'msgs';

const SCOPE_TABS: Array<NeoTabOption<UsageScope>> = [
	{ value: 'project', label: 'Project', title: 'This project only' },
	{
		value: 'global',
		label: (
			<span className="inline-flex items-center gap-1">
				<Globe2 className="size-3" />
				Global
			</span>
		),
		title: 'Every registered project',
	},
];

const MODEL_SORTS: Array<NeoTabOption<ModelSort>> = [
	{ value: 'cost', label: 'Cost' },
	{ value: 'tokens', label: 'Tokens' },
	{ value: 'msgs', label: 'Msgs' },
];

const RANGE_TABS: Array<NeoTabOption<UsageRangeKey>> = RANGE_OPTIONS.map(
	(option) => ({
		value: option.value,
		label: option.label,
		title: option.title,
	}),
);

/** `null` when the provider reports no prompt tokens, so the tag is dropped. */
function cacheRate(counts: {
	inputTokens: number;
	cachedInputTokens: number;
	cacheCreationInputTokens: number;
}): string | null {
	const rate = cacheHitRate(counts);
	return rate === null ? null : `${formatPct(rate)} cached`;
}

export function UsageDashboard({ onBack }: UsageDashboardProps) {
	const {
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
		previous,
		refresh,
		scopeLabel,
	} = useUsageDashboardData();

	const [metric, setMetric] = useState<ChartMetric>('cost');
	const [modelSort, setModelSort] = useState<ModelSort>('cost');
	const [provider, setProvider] = useState<string | null>(null);

	const handleBack = useCallback(() => {
		if (onBack) return onBack();
		if (typeof window === 'undefined') return;
		if (window.history.length > 1) window.history.back();
		else window.location.assign('/');
	}, [onBack]);

	const providerItems = useMemo<BreakdownItem[]>(() => {
		if (!stats) return [];
		return stats.providers.map((entry) => ({
			key: entry.provider,
			label: entry.provider,
			icon: <ProviderLogo provider={entry.provider} size={15} />,
			value: entry.notionalCostUsd,
			valueLabel: formatUsd(entry.notionalCostUsd),
			metaLabel: `${formatNumber(entry.inputTokens + entry.outputTokens)} tok`,
			sublabel: [
				`${formatNumber(entry.messages)} msgs`,
				`${formatNumber(entry.sessions)} sessions`,
				authTag(entry.authType),
				cacheRate(entry),
			]
				.filter(Boolean)
				.join(' · '),
			title: `Filter models by ${entry.provider}`,
		}));
	}, [stats]);

	const modelItems = useMemo<BreakdownItem[]>(() => {
		if (!stats) return [];
		const rows = provider
			? stats.models.filter((model) => model.provider === provider)
			: stats.models;
		const sorted = [...rows].sort((a, b) => {
			if (modelSort === 'tokens') {
				return (
					b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)
				);
			}
			if (modelSort === 'msgs') return b.messages - a.messages;
			return b.notionalCostUsd - a.notionalCostUsd;
		});
		return sorted.map((model) => ({
			key: `${model.provider}/${model.model}`,
			label: model.model,
			icon: <ProviderLogo provider={model.provider} size={14} />,
			value:
				modelSort === 'tokens'
					? model.inputTokens + model.outputTokens
					: modelSort === 'msgs'
						? model.messages
						: model.notionalCostUsd,
			valueLabel:
				modelSort === 'tokens'
					? `${formatNumber(model.inputTokens + model.outputTokens)} tok`
					: modelSort === 'msgs'
						? `${formatNumber(model.messages)} msgs`
						: formatUsd(model.notionalCostUsd),
			metaLabel: authTag(model.authType),
			sublabel: `${model.provider} · ${formatNumber(
				model.messages,
			)} msgs · ${formatNumber(model.inputTokens + model.outputTokens)} tok`,
			title: `${model.provider}/${model.model}`,
		}));
	}, [stats, provider, modelSort]);

	const empty = Boolean(stats && stats.totals.messages === 0);

	return (
		<div
			data-native-overlay-root="true"
			className={cn(
				'fixed inset-0 z-50 flex flex-col bg-background text-foreground',
				NEO_SCOPE,
			)}
		>
			<header className="shrink-0 border-b-2 border-[rgb(var(--np-edge))] bg-card">
				<div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
					<div className="flex min-w-0 items-center gap-2.5">
						<NeoIconButton label="Back" onClick={handleBack}>
							<ArrowLeft className="size-3.5" />
						</NeoIconButton>
						<div className="flex min-w-0 items-baseline gap-1.5">
							<span className={cn(NEO_EYEBROW, 'text-muted-foreground')}>
								Usage
							</span>
							<span className="text-muted-foreground/50">/</span>
							<span className="truncate text-[13px] font-medium">
								{scopeLabel || '—'}
							</span>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<NeoTabs
							aria-label="Usage scope"
							options={SCOPE_TABS}
							value={scope}
							onChange={(value) => {
								setScope(value);
								setProvider(null);
							}}
						/>
						<NeoTabs
							aria-label="Date range"
							options={RANGE_TABS}
							value={rangeKey}
							onChange={setRangeKey}
						/>
						<NeoIconButton label="Refresh" onClick={refresh} disabled={loading}>
							<RefreshCw
								className={cn('size-3.5', loading && 'animate-spin')}
							/>
						</NeoIconButton>
					</div>
				</div>
			</header>

			<main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<div className="mx-auto w-full max-w-[1100px] space-y-4 px-4 py-8 sm:px-6">
					{error && (
						<div
							className={cn(
								'border-2 border-[rgb(var(--np-coral))] bg-[rgb(var(--np-coral)/0.1)] px-4 py-3',
								NEO_RADIUS,
							)}
						>
							<p className="text-[13px]">{error}</p>
						</div>
					)}

					{loading && !stats && <UsageSkeleton />}

					{stats && empty && (
						<NeoPanel elevation="sm" className="px-6 py-12 text-center">
							<p className="text-[13px] font-medium">No usage recorded yet</p>
							<p className="mt-2 text-[12px] text-muted-foreground">
								Send a message in this{' '}
								{scope === 'global' ? 'workspace' : 'project'} and the breakdown
								will appear here.
							</p>
						</NeoPanel>
					)}

					{stats && !empty && (
						<>
							<UsageHero
								totals={stats.totals}
								previous={previous}
								series={series}
								activeDays={activeDays}
								rangeLabel={rangeLabel}
							/>

							<UsageInsights
								stats={stats}
								series={series}
								activeDays={activeDays}
								rangeLabel={rangeLabel}
							/>

							<UsageSection
								title="Daily activity"
								subtitle={`${rangeLabel} · ${series.length} days`}
							>
								<UsageActivityChart
									series={series}
									metric={metric}
									onMetricChange={setMetric}
								/>
							</UsageSection>

							<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
								<UsageSection
									title="How you're paying"
									subtitle={rangeLabel.toLowerCase()}
								>
									<UsagePaymentSplit
										stats={stats}
										resetKey={`${scope}:${rangeKey}`}
									/>
								</UsageSection>

								<UsageSection
									title="By provider"
									subtitle={`${rangeLabel.toLowerCase()} · select one to filter models`}
									actions={
										provider ? (
											<button
												type="button"
												onClick={() => setProvider(null)}
												className="inline-flex items-center gap-1"
											>
												<NeoBadge accent="blue">
													{provider}
													<X className="size-2.5" />
												</NeoBadge>
											</button>
										) : undefined
									}
								>
									<BreakdownList
										items={providerItems}
										limit={8}
										emptyLabel="No providers used yet"
										resetKey={`${scope}:${rangeKey}`}
										selectedKey={provider}
										onSelect={(key) =>
											setProvider((current) => (current === key ? null : key))
										}
									/>
								</UsageSection>
							</div>

							<UsageSection
								title={provider ? `Models · ${provider}` : 'Top models'}
								subtitle={`${rangeLabel.toLowerCase()} · ${
									modelItems.length
								} model${modelItems.length === 1 ? '' : 's'}`}
								actions={
									<NeoTabs
										aria-label="Sort models"
										options={MODEL_SORTS}
										value={modelSort}
										onChange={(value) => setModelSort(value)}
									/>
								}
							>
								<BreakdownList
									items={modelItems}
									limit={8}
									emptyLabel="No model usage yet"
									resetKey={`${scope}:${rangeKey}:${modelSort}:${provider ?? ''}`}
								/>
							</UsageSection>

							<UsageSection
								title="Cache efficiency"
								subtitle={`${rangeLabel.toLowerCase()} · prompt tokens served from cache`}
							>
								<UsageCache stats={stats} resetKey={`${scope}:${rangeKey}`} />
							</UsageSection>

							{scope === 'global' && stats.projects && (
								<UsageSection
									title="Projects"
									subtitle={
										stats.projects.unavailable.length > 0
											? `${stats.projects.included.length} included · ${stats.projects.unavailable.length} unavailable`
											: `${stats.projects.included.length} included`
									}
								>
									<UsageProjects projects={stats.projects} />
								</UsageSection>
							)}

							<div className="flex flex-wrap items-center justify-center gap-2 pb-4 pt-1">
								{stats.notes.missingPricing.length > 0 && (
									<NeoBadge
										accent="yellow"
										title={stats.notes.missingPricing.join('\n')}
									>
										pricing missing · {stats.notes.missingPricing.length} model
										{stats.notes.missingPricing.length === 1 ? '' : 's'}
									</NeoBadge>
								)}
								<span className="text-[11px] text-muted-foreground">
									estimated from catalog pricing · generated{' '}
									{new Date(stats.generatedAt).toLocaleString()}
								</span>
							</div>
						</>
					)}
				</div>
			</main>
		</div>
	);
}
