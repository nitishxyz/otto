import { catalog } from './catalog-merged.ts';
import type { ModelInfo, ProviderId } from '../../types/src/index.ts';

type ProviderName = ProviderId;

type UsageLike = {
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedInputTokens?: number | null;
	cacheCreationInputTokens?: number | null;
};

type PricingEntry = {
	/** Cost in USD per 1 million input tokens */
	inputPerMillion: number;
	/** Cost in USD per 1 million output tokens */
	outputPerMillion: number;
	match: (model: string) => boolean;
};

const pricingTable: Record<ProviderName, PricingEntry[]> = {
	openai: [
		{
			match: (model) => model.includes('gpt-4o-mini'),
			inputPerMillion: 0.15,
			outputPerMillion: 0.6,
		},
		{
			match: (model) => model.includes('gpt-4o'),
			inputPerMillion: 5,
			outputPerMillion: 15,
		},
		{
			match: (model) => model.includes('gpt-4.1-mini'),
			inputPerMillion: 1,
			outputPerMillion: 4,
		},
		{
			match: (model) => model.includes('gpt-4.1'),
			inputPerMillion: 5,
			outputPerMillion: 15,
		},
	],
	anthropic: [
		{
			match: (model) => model.includes('claude-3-haiku'),
			inputPerMillion: 0.25,
			outputPerMillion: 1.25,
		},
		{
			match: (model) => model.includes('claude-3-sonnet'),
			inputPerMillion: 3,
			outputPerMillion: 15,
		},
		{
			match: (model) => model.includes('claude-3-opus'),
			inputPerMillion: 15,
			outputPerMillion: 75,
		},
	],
	google: [
		{
			match: (model) => model.includes('gemini-1.5-flash'),
			inputPerMillion: 0.35,
			outputPerMillion: 1.05,
		},
		{
			match: (model) => model.includes('gemini-1.5-pro'),
			inputPerMillion: 3.5,
			outputPerMillion: 10.5,
		},
	],
	'ollama-cloud': [
		// Pricing can vary by your Ollama Cloud model/account; leave undefined here
	],
	openrouter: [
		// Prefer catalog pricing; keep empty to defer to catalog or undefined
	],
	opencode: [
		// Pricing from catalog entries; leave empty here
	],
	ottorouter: [
		// Pricing from catalog entries; leave empty here
	],
	xai: [
		// Pricing from catalog entries; leave empty here
	],
	zai: [
		// Pricing from catalog entries; leave empty here
	],
	'zai-coding': [
		// Pricing from catalog entries; leave empty here
	],
	deepseek: [
		// Pricing from catalog entries; leave empty here
	],
	kimi: [
		// Pricing from catalog entries; leave empty here
	],
	minimax: [
		// Pricing from catalog entries; leave empty here
	],
	copilot: [],
};

function findPricing(
	provider: ProviderName,
	model: string,
): PricingEntry | undefined {
	const entries = pricingTable[provider];
	if (!entries) return undefined;
	return entries.find((entry) => {
		try {
			return entry.match(model);
		} catch {
			return false;
		}
	});
}

function findCatalogModel(
	provider: ProviderName,
	model: string,
): ModelInfo | undefined {
	const entry = catalog[provider as keyof typeof catalog];
	if (!entry) return undefined;
	const idLower = model.toLowerCase();
	return entry.models.find((m) => m.id?.toLowerCase() === idLower);
}

export function estimateModelCostUsd(
	provider: ProviderName,
	model: string,
	usage: UsageLike,
): number | undefined {
	const inputTokens =
		typeof usage.inputTokens === 'number' ? usage.inputTokens : 0;
	const outputTokens =
		typeof usage.outputTokens === 'number' ? usage.outputTokens : 0;
	const cachedInputTokens =
		typeof usage.cachedInputTokens === 'number' ? usage.cachedInputTokens : 0;
	const cacheCreationInputTokens =
		typeof usage.cacheCreationInputTokens === 'number'
			? usage.cacheCreationInputTokens
			: 0;
	if (
		!inputTokens &&
		!outputTokens &&
		!cachedInputTokens &&
		!cacheCreationInputTokens
	)
		return undefined;

	// Prefer centralized catalog costs when available
	const m = findCatalogModel(provider, model);
	if (m?.cost?.input != null || m?.cost?.output != null) {
		const inputPerMillion =
			typeof m.cost?.input === 'number' ? m.cost.input : 0;
		const outputPerMillion =
			typeof m.cost?.output === 'number' ? m.cost.output : 0;
		const cacheReadPerMillion =
			typeof m.cost?.cacheRead === 'number' ? m.cost.cacheRead : 0;
		const cacheWritePerMillion =
			typeof m.cost?.cacheWrite === 'number' ? m.cost.cacheWrite : 0;
		const nonCachedInput = Math.max(
			0,
			inputTokens - cachedInputTokens - cacheCreationInputTokens,
		);
		const inputCost = (nonCachedInput * inputPerMillion) / 1_000_000;
		const outputCost = (outputTokens * outputPerMillion) / 1_000_000;
		const cacheReadCost = (cachedInputTokens * cacheReadPerMillion) / 1_000_000;
		const cacheWriteCost =
			(cacheCreationInputTokens * cacheWritePerMillion) / 1_000_000;
		const total = inputCost + outputCost + cacheReadCost + cacheWriteCost;
		return Number.isFinite(total) ? Number(total.toFixed(6)) : undefined;
	}

	// Fallback to legacy table if catalog lacks pricing
	const entry = findPricing(provider, model.toLowerCase());
	if (!entry) return undefined;
	const nonCachedInputFallback = Math.max(
		0,
		inputTokens - cachedInputTokens - cacheCreationInputTokens,
	);
	const inputCost =
		(nonCachedInputFallback * entry.inputPerMillion) / 1_000_000;
	const outputCost = (outputTokens * entry.outputPerMillion) / 1_000_000;
	const total = inputCost + outputCost;
	return Number.isFinite(total) ? Number(total.toFixed(6)) : undefined;
}
