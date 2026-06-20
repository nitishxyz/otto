import { catalog, isBuiltInProviderId, type ProviderId } from '@ottocode/sdk';
import type { ProviderMetadata, UsageData } from './types.ts';

export function normalizeUsage(
	usage: UsageData,
	providerOptions: ProviderMetadata | undefined,
	provider: ProviderId,
): UsageData {
	const rawInputTokens = Number(usage.inputTokens ?? 0);
	const outputTokens = Number(usage.outputTokens ?? 0);
	const reasoningTokens = Number(usage.reasoningTokens ?? 0);

	const cachedInputTokens =
		usage.cachedInputTokens != null
			? Number(usage.cachedInputTokens)
			: providerOptions?.openai?.cachedPromptTokens != null
				? Number(providerOptions.openai.cachedPromptTokens)
				: providerOptions?.anthropic?.cacheReadInputTokens != null
					? Number(providerOptions.anthropic.cacheReadInputTokens)
					: undefined;

	const cacheCreationInputTokens =
		usage.cacheCreationInputTokens != null
			? Number(usage.cacheCreationInputTokens)
			: providerOptions?.anthropic?.cacheCreationInputTokens != null
				? Number(providerOptions.anthropic.cacheCreationInputTokens)
				: undefined;

	const cachedValue = cachedInputTokens ?? 0;

	let inputTokens = rawInputTokens;
	if (provider === 'openai') {
		inputTokens = Math.max(0, rawInputTokens - cachedValue);
	}

	return {
		inputTokens,
		outputTokens,
		cachedInputTokens,
		cacheCreationInputTokens,
		reasoningTokens,
	};
}

export function resolveUsageProvider(
	provider: ProviderId,
	model: string,
): ProviderId {
	if (
		provider !== 'ottorouter' &&
		provider !== 'openrouter' &&
		provider !== 'opencode'
	) {
		return provider;
	}
	const entry = isBuiltInProviderId(provider) ? catalog[provider] : undefined;
	const normalizedModel = model.includes('/') ? model.split('/').at(-1) : model;
	const modelEntry = Object.values(entry?.models ?? {}).find(
		(modelConfig: { id?: string }) =>
			modelConfig.id?.toLowerCase() === normalizedModel?.toLowerCase(),
	);
	const npm = modelEntry?.provider?.npm ?? '';
	if (npm.includes('openai')) return 'openai';
	if (npm.includes('anthropic')) return 'anthropic';
	if (npm.includes('google')) return 'google';
	if (npm.includes('zai')) return 'zai';
	return provider;
}
