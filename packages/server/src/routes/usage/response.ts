import type { UsageRange } from './range.ts';
import type {
	ProjectAggregate,
	UsageStatsResponse,
	UsageTotals,
} from './types.ts';

const round = (value: number) => Number(value.toFixed(6));

function roundTotals(totals: UsageTotals): UsageTotals {
	return {
		...totals,
		costUsd: round(totals.costUsd),
		notionalCostUsd: round(totals.notionalCostUsd),
		savedUsd: round(totals.savedUsd),
		costByAuth: {
			oauth: round(totals.costByAuth.oauth),
			api: round(totals.costByAuth.api),
			subscription: round(totals.costByAuth.subscription),
		},
	};
}

export function finalizeResponse(
	scope: 'project' | 'global',
	projectLabel: string,
	agg: ProjectAggregate,
	extras?: UsageStatsResponse['projects'],
	range?: UsageRange,
): UsageStatsResponse {
	const providersArr = Array.from(agg.providers.values()).sort(
		(a, b) => b.notionalCostUsd - a.notionalCostUsd || b.messages - a.messages,
	);
	const modelsArr = Array.from(agg.models.values()).sort(
		(a, b) => b.notionalCostUsd - a.notionalCostUsd || b.messages - a.messages,
	);
	const dailyArr = Array.from(agg.daily.values()).sort((a, b) =>
		a.date.localeCompare(b.date),
	);

	const oauthProviders = providersArr
		.filter((provider) => provider.authType === 'oauth')
		.map((provider) => provider.provider);
	const subscriptionProviders = providersArr
		.filter(
			(provider) =>
				provider.authType === 'subscription' || provider.authType === 'wallet',
		)
		.map((provider) => provider.provider);

	return {
		scope,
		project: projectLabel,
		generatedAt: Date.now(),
		range: {
			days: range?.days ?? null,
			since: range?.sinceMs ?? null,
		},
		totals: roundTotals(agg.totals),
		// Only meaningful for a bounded window: all-time has no prior period.
		previousTotals: range ? roundTotals(agg.previousTotals) : null,
		providers: providersArr.map((provider) => ({
			...provider,
			costUsd: round(provider.costUsd),
			notionalCostUsd: round(provider.notionalCostUsd),
		})),
		models: modelsArr.map((model) => ({
			...model,
			costUsd: round(model.costUsd),
			notionalCostUsd: round(model.notionalCostUsd),
		})),
		daily: dailyArr.map((daily) => ({
			...daily,
			costUsd: round(daily.costUsd),
			notionalCostUsd: round(daily.notionalCostUsd),
			costByAuth: {
				oauth: round(daily.costByAuth.oauth),
				api: round(daily.costByAuth.api),
				subscription: round(daily.costByAuth.subscription),
			},
			notionalByAuth: {
				oauth: round(daily.notionalByAuth.oauth),
				api: round(daily.notionalByAuth.api),
				subscription: round(daily.notionalByAuth.subscription),
			},
		})),
		notes: {
			oauthProviders,
			subscriptionProviders,
			missingPricing: Array.from(agg.missingPricing).sort(),
		},
		projects: extras,
	};
}
