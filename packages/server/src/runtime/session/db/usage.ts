import type { ProviderId } from '@ottocode/sdk';
import type { ProviderMetadata, UsageData } from './types.ts';

export { resolveUsageProvider } from '@ottocode/sdk';

export function normalizeUsage(
	usage: UsageData,
	providerOptions: ProviderMetadata | undefined,
	_provider: ProviderId,
): UsageData {
	const rawInputTokens = Number(usage.inputTokens ?? 0);
	const outputTokens = Number(usage.outputTokens ?? 0);
	const reasoningTokens = Number(usage.reasoningTokens ?? 0);
	const inputTokenDetails = usage.inputTokenDetails;

	const cachedInputTokens =
		inputTokenDetails?.cacheReadTokens != null
			? Number(inputTokenDetails.cacheReadTokens)
			: usage.cachedInputTokens != null
				? Number(usage.cachedInputTokens)
				: providerOptions?.openai?.cachedPromptTokens != null
					? Number(providerOptions.openai.cachedPromptTokens)
					: providerOptions?.anthropic?.cacheReadInputTokens != null
						? Number(providerOptions.anthropic.cacheReadInputTokens)
						: undefined;

	const cacheCreationInputTokens =
		inputTokenDetails?.cacheWriteTokens != null
			? Number(inputTokenDetails.cacheWriteTokens)
			: usage.cacheCreationInputTokens != null
				? Number(usage.cacheCreationInputTokens)
				: providerOptions?.anthropic?.cacheCreationInputTokens != null
					? Number(providerOptions.anthropic.cacheCreationInputTokens)
					: undefined;

	const cachedValue = Math.max(0, cachedInputTokens ?? 0);
	const cacheCreationValue = Math.max(0, cacheCreationInputTokens ?? 0);

	const reportedNoCacheTokens = inputTokenDetails?.noCacheTokens;
	const includedCacheTokens = cachedValue + cacheCreationValue;
	const inputTokens =
		reportedNoCacheTokens != null
			? Math.max(0, Number(reportedNoCacheTokens))
			: includedCacheTokens > 0 && rawInputTokens >= includedCacheTokens
				? rawInputTokens - includedCacheTokens
				: rawInputTokens;

	return {
		inputTokens,
		outputTokens,
		cachedInputTokens,
		cacheCreationInputTokens,
		reasoningTokens,
	};
}
