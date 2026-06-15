import { catalog } from './catalog-merged.ts';
import { filterAvailableKimiModels } from './catalog-manual.ts';
import { getCachedProviderCatalogEntry } from './model-catalog-cache.ts';
import { mergeModelLists } from './model-merge.ts';
import type {
	BuiltInProviderId,
	ProviderId,
	ModelInfo,
	ModelOwner,
} from '../../types/src/index.ts';
import { filterModelsForAuthType } from './oauth-models.ts';
import { resolveBuiltInProviderCatalogId } from './registry.ts';

export const providerIds = Object.keys(catalog) as BuiltInProviderId[];

export function isProviderId(value: unknown): value is BuiltInProviderId {
	return (
		typeof value === 'string' &&
		providerIds.includes(value as BuiltInProviderId)
	);
}

export function defaultModelFor(provider: ProviderId): string | undefined {
	return getProviderModels(provider)[0]?.id;
}

export function listModels(provider: ProviderId): string[] {
	return getProviderModels(provider).map((m) => m.id);
}

export function hasModel(
	provider: ProviderId,
	model: string | undefined,
): boolean {
	if (!model) return false;
	return listModels(provider).includes(model);
}

const PREFERRED_FAST_MODELS: Partial<Record<ProviderId, string[]>> = {
	openai: ['gpt-4.1-mini'],
	anthropic: ['claude-3-5-haiku-latest'],
	google: ['gemini-2.0-flash-lite'],
	openrouter: ['anthropic/claude-3.5-haiku'],
	opencode: ['claude-3-5-haiku'],
	ottorouter: ['glm-5-turbo'],
	xai: ['grok-code-fast-1', 'grok-4-fast'],
	zai: ['glm-4.5-flash'],
	copilot: ['gpt-4.1-mini'],
	kimi: ['kimi-k2.7-code'],
};

const PREFERRED_FAST_MODELS_OAUTH: Partial<Record<ProviderId, string[]>> = {
	openai: ['gpt-5.4-mini'],
	anthropic: ['claude-haiku-4-5'],
	kimi: ['kimi-k2.7-code'],
};

function preferredFastModelKey(provider: ProviderId): ProviderId {
	return resolveBuiltInProviderCatalogId(provider) ?? provider;
}

export function getFastModel(provider: ProviderId): string | undefined {
	const providerModels = getProviderModels(provider);
	if (!providerModels.length) return undefined;

	const preferred =
		PREFERRED_FAST_MODELS[preferredFastModelKey(provider)] ?? [];
	for (const modelId of preferred) {
		if (providerModels.some((m) => m.id === modelId)) {
			return modelId;
		}
	}

	const sorted = [...providerModels]
		.filter((m) => m.cost?.input !== undefined && m.toolCall !== false)
		.sort((a, b) => (a.cost?.input ?? Infinity) - (b.cost?.input ?? Infinity));

	return sorted[0]?.id ?? providerModels[0]?.id;
}

export function getFastModelForAuth(
	provider: ProviderId,
	authType: 'api' | 'oauth' | 'wallet' | undefined,
): string | undefined {
	const providerModels = getProviderModels(provider);
	if (!providerModels.length) return undefined;

	const filteredModels = filterModelsForAuthType(
		provider,
		providerModels,
		authType,
	);
	if (!filteredModels.length) return getFastModel(provider);

	const preferredMap =
		authType === 'oauth' ? PREFERRED_FAST_MODELS_OAUTH : PREFERRED_FAST_MODELS;
	const preferred = preferredMap[preferredFastModelKey(provider)] ?? [];
	for (const modelId of preferred) {
		if (filteredModels.some((m) => m.id === modelId)) {
			return modelId;
		}
	}

	const sorted = [...filteredModels]
		.filter(
			(m: ModelInfo) => m.cost?.input !== undefined && m.toolCall !== false,
		)
		.sort(
			(a: ModelInfo, b: ModelInfo) =>
				(a.cost?.input ?? Infinity) - (b.cost?.input ?? Infinity),
		);

	return sorted[0]?.id ?? filteredModels[0]?.id;
}

export function getModelNpmBinding(
	provider: ProviderId,
	model: string,
): string | undefined {
	const catalogProvider = resolveBuiltInProviderCatalogId(provider);
	const entry = catalogProvider ? catalog[catalogProvider] : undefined;
	const modelInfo = getProviderModels(provider).find((m) => m.id === model);
	if (modelInfo?.provider?.npm) return modelInfo.provider.npm;
	if (entry?.npm) return entry.npm;

	for (const key of Object.keys(catalog) as BuiltInProviderId[]) {
		const e = catalog[key];
		const m = getProviderModels(key).find((x) => x.id === model);
		if (m?.provider?.npm) return m.provider.npm;
		if (m && e?.npm) return e.npm;
	}
	return undefined;
}

export function isAnthropicBasedModel(
	provider: ProviderId,
	model: string,
): boolean {
	const info = getModelInfo(provider, model);
	if (info?.ownedBy === 'anthropic') return true;
	if (provider === 'anthropic') return true;
	return false;
}

const OWNER_TO_FAMILY: Record<ModelOwner, UnderlyingProviderKey> = {
	openai: 'openai',
	anthropic: 'anthropic',
	google: 'google',
	openrouter: 'openai-compatible',
	xai: 'openai',
	kimi: 'kimi',
	qwen: 'openai-compatible',
	zai: 'glm',
	minimax: 'minimax',
};

const DIRECT_PROVIDER_FAMILY: Partial<
	Record<ProviderId, UnderlyingProviderKey>
> = {
	openai: 'openai',
	anthropic: 'anthropic',
	google: 'google',
	'ollama-cloud': 'openai-compatible',
	kimi: 'kimi',
	minimax: 'minimax',
	copilot: 'openai',
	xai: 'openai',
	zai: 'glm',
	'zai-coding': 'glm',
};

export type UnderlyingProviderKey =
	| 'anthropic'
	| 'openai'
	| 'google'
	| 'kimi'
	| 'minimax'
	| 'glm'
	| 'openai-compatible'
	| null;

function inferFromModelId(model: string): UnderlyingProviderKey {
	const lower = model.toLowerCase();
	if (lower.includes('claude') || lower.startsWith('anthropic/'))
		return 'anthropic';
	if (
		lower.includes('gpt') ||
		lower.startsWith('openai/') ||
		lower.includes('codex')
	)
		return 'openai';
	if (lower.includes('gemini') || lower.startsWith('google/')) return 'google';
	if (lower.includes('grok') || lower.startsWith('xai/')) return 'openai';
	if (lower.includes('qwen') || lower.startsWith('qwen/'))
		return 'openai-compatible';
	if (lower.includes('kimi') || lower.startsWith('moonshotai/')) return 'kimi';
	if (
		lower.includes('glm') ||
		lower.startsWith('z-ai/') ||
		lower.startsWith('thudm/')
	)
		return 'glm';
	if (lower.includes('minimax')) return 'minimax';
	return null;
}

export function getUnderlyingProviderKey(
	provider: ProviderId,
	model: string,
): UnderlyingProviderKey {
	const info = getModelInfo(provider, model);
	if (info?.ownedBy) {
		return OWNER_TO_FAMILY[info.ownedBy];
	}

	const direct = DIRECT_PROVIDER_FAMILY[provider];
	if (direct) return direct;

	const fromId = inferFromModelId(model);
	if (fromId) return fromId;

	const npm = getModelNpmBinding(provider, model);
	if (npm === '@ai-sdk/anthropic') return 'anthropic';
	if (npm === '@ai-sdk/openai') return 'openai';
	if (npm === '@ai-sdk/google') return 'google';
	if (npm === 'ai-sdk-ollama') return 'openai-compatible';
	if (npm === '@ai-sdk/openai-compatible') return 'openai-compatible';
	if (npm === '@openrouter/ai-sdk-provider') return 'openai-compatible';
	if (provider === 'ottorouter') return 'openai-compatible';
	return null;
}

export function getModelFamily(
	provider: ProviderId,
	model: string,
): UnderlyingProviderKey {
	const info = getModelInfo(provider, model);
	if (info?.ownedBy) {
		return OWNER_TO_FAMILY[info.ownedBy];
	}

	const direct = DIRECT_PROVIDER_FAMILY[provider];
	if (direct) return direct;

	return getUnderlyingProviderKey(provider, model);
}

export function getModelInfo(
	provider: ProviderId,
	model: string,
): ModelInfo | undefined {
	const catalogProvider = resolveBuiltInProviderCatalogId(provider);
	const entry = catalogProvider ? catalog[catalogProvider] : undefined;
	if (!entry) return undefined;
	return getProviderModels(provider).find((m) => m.id === model);
}

function getProviderModels(provider: ProviderId): ModelInfo[] {
	const catalogProvider = resolveBuiltInProviderCatalogId(provider);
	const catalogModels = catalogProvider
		? catalog[catalogProvider]?.models
		: undefined;
	const cachedModels = getCachedProviderCatalogEntry(
		catalogProvider ?? provider,
	)?.models;
	const models = mergeModelLists(catalogModels, cachedModels);
	return catalogProvider === 'kimi'
		? filterAvailableKimiModels(models)
		: models;
}

export function modelSupportsReasoning(
	provider: ProviderId,
	model: string,
): boolean {
	const info = getModelInfo(provider, model);
	return info?.reasoningText === true;
}
