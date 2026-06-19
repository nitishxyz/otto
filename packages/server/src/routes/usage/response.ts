import type { ProjectAggregate, UsageStatsResponse } from './types.ts';

export function finalizeResponse(
	scope: 'project' | 'global',
	projectLabel: string,
	agg: ProjectAggregate,
	extras?: UsageStatsResponse['projects'],
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

	const round = (value: number) => Number(value.toFixed(6));

	return {
		scope,
		project: projectLabel,
		generatedAt: Date.now(),
		totals: {
			messages: agg.totals.messages,
			sessions: agg.totals.sessions,
			inputTokens: agg.totals.inputTokens,
			outputTokens: agg.totals.outputTokens,
			cachedInputTokens: agg.totals.cachedInputTokens,
			cacheCreationInputTokens: agg.totals.cacheCreationInputTokens,
			reasoningTokens: agg.totals.reasoningTokens,
			costUsd: round(agg.totals.costUsd),
			notionalCostUsd: round(agg.totals.notionalCostUsd),
			savedUsd: round(agg.totals.savedUsd),
			costByAuth: {
				oauth: round(agg.totals.costByAuth.oauth),
				api: round(agg.totals.costByAuth.api),
				subscription: round(agg.totals.costByAuth.subscription),
			},
			messagesByAuth: agg.totals.messagesByAuth,
		},
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
