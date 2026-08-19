import { catalog } from './catalog-merged.ts';
import { filterAvailableKimiModels } from './catalog-manual.ts';
import { getCachedProviderCatalogEntry } from './model-catalog-cache.ts';
import { modelMapToList } from './model-map.ts';
import { mergeModelMaps } from './model-merge.ts';
import type {
	BuiltInProviderId,
	ProviderId,
	ProviderCompatibility,
	ProviderPromptFamily,
	ModelInfo,
	ModelOwner,
	ModelInfoMap,
} from '../../types/src/index.ts';
import { builtInProviderIds } from '../../types/src/provider-descriptors.ts';
import { filterModelsForAuthType } from './oauth-models.ts';
import { resolveBuiltInProviderCatalogId } from './registry.ts';

export const providerIds: BuiltInProviderId[] = [...builtInProviderIds];

export function isProviderId(value: unknown): value is BuiltInProviderId {
	return (
		typeof value === 'string' &&
		providerIds.includes(value as BuiltInProviderId)
	);
}

export function defaultModelFor(provider: ProviderId): string | undefined {
	return modelMapToList(getProviderModels(provider))[0]?.id;
}

export function listModels(provider: ProviderId): string[] {
	return Object.keys(getProviderModels(provider));
}

export function hasModel(
	provider: ProviderId,
	model: string | undefined,
): boolean {
	if (!model) return false;
	return getProviderModels(provider)[model] !== undefined;
}

const PREFERRED_FAST_MODELS: Partial<Record<ProviderId, string[]>> = {
	openai: ['gpt-4.1-mini'],
	anthropic: ['claude-3-5-haiku-latest'],
	google: ['gemini-2.0-flash-lite'],
	meta: ['muse-spark-1.1'],
	baseten: ['nvidia/Nemotron-120B-A12B'],
	huggingface: ['deepseek-ai/DeepSeek-V4-Flash:deepinfra'],
	wafer: ['glm5.2-fast'],
	openrouter: ['anthropic/claude-3.5-haiku'],
	opencode: ['claude-3-5-haiku'],
	ottorouter: ['gemini-3.5-flash'],
	xai: ['grok-code-fast-1', 'grok-4-fast'],
	zai: ['glm-4.5-flash'],
	deepseek: ['deepseek-v4-flash'],
	copilot: ['gpt-4.1-mini'],
	kimi: ['kimi-k2.7-code'],
	minimax: ['MiniMax-M2.7'],
};

const PREFERRED_FAST_MODELS_OAUTH: Partial<Record<ProviderId, string[]>> = {
	openai: ['gpt-5.4-mini'],
	anthropic: ['claude-haiku-4-5'],
	kimi: ['kimi-k2.7-code'],
	ottorouter: ['gemini-3.5-flash'],
};

function preferredFastModelKey(provider: ProviderId): ProviderId {
	return resolveBuiltInProviderCatalogId(provider) ?? provider;
}

export type FastModelAuthType = 'api' | 'oauth' | 'wallet' | undefined;

export function selectFastModel(
	provider: ProviderId,
	providerModels: ModelInfoMap,
	options?: {
		authType?: FastModelAuthType;
		configuredFastModels?: readonly string[];
		allowAnyModel?: boolean;
		useBuiltInPreferred?: boolean;
	},
): string | undefined {
	const filteredModels = filterModelsForAuthType(
		provider,
		providerModels,
		options?.authType,
	);
	const candidateModels = Object.keys(filteredModels).length
		? filteredModels
		: providerModels;
	const candidateModelList = modelMapToList(candidateModels);
	const configuredFastModels = options?.configuredFastModels?.filter(
		(modelId) => typeof modelId === 'string' && modelId.trim().length > 0,
	);

	if (configuredFastModels?.length) {
		for (const modelId of configuredFastModels) {
			if (
				options?.allowAnyModel === true ||
				candidateModels[modelId] !== undefined
			) {
				return modelId;
			}
		}
	}

	if (!candidateModelList.length) return undefined;
	if (options?.useBuiltInPreferred === false) {
		return candidateModelList[0]?.id;
	}

	const preferredMap =
		options?.authType === 'oauth'
			? PREFERRED_FAST_MODELS_OAUTH
			: PREFERRED_FAST_MODELS;
	const preferred = preferredMap[preferredFastModelKey(provider)] ?? [];
	for (const modelId of preferred) {
		if (candidateModels[modelId] !== undefined) {
			return modelId;
		}
	}

	const sorted = [...candidateModelList]
		.filter(
			(m: ModelInfo) => m.cost?.input !== undefined && m.toolCall !== false,
		)
		.sort(
			(a: ModelInfo, b: ModelInfo) =>
				(a.cost?.input ?? Infinity) - (b.cost?.input ?? Infinity),
		);

	return sorted[0]?.id ?? candidateModelList[0]?.id;
}

export function getFastModel(provider: ProviderId): string | undefined {
	return selectFastModel(provider, getProviderModels(provider));
}

export function getFastModelForAuth(
	provider: ProviderId,
	authType: FastModelAuthType,
): string | undefined {
	return selectFastModel(provider, getProviderModels(provider), { authType });
}

export function getModelNpmBinding(
	provider: ProviderId,
	model: string,
): string | undefined {
	const catalogProvider = resolveBuiltInProviderCatalogId(provider);
	const entry = catalogProvider ? catalog[catalogProvider] : undefined;
	const modelInfo = getProviderModels(provider)[model];
	if (modelInfo?.provider?.npm) return modelInfo.provider.npm;
	if (entry?.npm) return entry.npm;

	for (const key of Object.keys(catalog) as BuiltInProviderId[]) {
		const e = catalog[key];
		const m = getProviderModels(key)[model];
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

const OWNER_TO_FAMILY: Record<
	ModelOwner,
	Exclude<UnderlyingProviderKey, null>
> = {
	openai: 'openai',
	anthropic: 'anthropic',
	google: 'google',
	meta: 'openai',
	openrouter: 'openai-compatible',
	xai: 'openai',
	kimi: 'kimi',
	qwen: 'openai-compatible',
	zai: 'glm',
	deepseek: 'openai-compatible',
	minimax: 'minimax',
};

const DIRECT_PROVIDER_FAMILY: Partial<
	Record<ProviderId, UnderlyingProviderKey>
> = {
	openai: 'openai',
	anthropic: 'anthropic',
	google: 'google',
	meta: 'openai',
	'ollama-cloud': 'openai-compatible',
	baseten: 'openai-compatible',
	huggingface: 'openai-compatible',
	wafer: 'openai-compatible',
	kimi: 'kimi',
	minimax: 'minimax',
	copilot: 'openai',
	xai: 'openai',
	zai: 'glm',
	'zai-coding': 'glm',
	deepseek: 'openai-compatible',
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

export function getModelProviderCompatibility(
	info: ModelInfo | undefined,
	fallback: ProviderCompatibility,
): ProviderCompatibility {
	if (info?.provider?.compatibility) return info.provider.compatibility;
	const npm = info?.provider?.npm;
	if (npm === '@ai-sdk/anthropic') return 'anthropic';
	if (npm === '@ai-sdk/openai') return 'openai';
	if (npm === '@ai-sdk/google') return 'google';
	if (npm === '@openrouter/ai-sdk-provider') return 'openrouter';
	if (npm === 'ai-sdk-ollama') return 'ollama';
	if (
		npm === '@ai-sdk/openai-compatible' ||
		npm === '@ai-sdk/baseten' ||
		npm === '@ai-sdk/huggingface'
	) {
		return 'openai-compatible';
	}
	return fallback;
}

export function getModelPromptFamily(
	info: ModelInfo | undefined,
	fallback: ProviderPromptFamily,
): ProviderPromptFamily {
	if (info?.provider?.family) return info.provider.family;
	if (info?.ownedBy) return OWNER_TO_FAMILY[info.ownedBy];
	if (!info?.provider?.npm && !info?.provider?.compatibility) return fallback;
	const compatibility = getModelProviderCompatibility(
		info,
		'openai-compatible',
	);
	if (
		compatibility === 'ollama' ||
		compatibility === 'openrouter' ||
		compatibility === 'openai-compatible'
	) {
		return 'openai-compatible';
	}
	return compatibility;
}

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
	if (
		lower.includes('muse-spark') ||
		lower.startsWith('meta/') ||
		lower.startsWith('meta-llama/') ||
		lower.startsWith('llama')
	)
		return 'openai';
	if (lower.includes('grok') || lower.startsWith('xai/')) return 'openai';
	if (lower.includes('qwen') || lower.startsWith('qwen/'))
		return 'openai-compatible';
	if (lower.includes('deepseek') || lower.startsWith('deepseek/'))
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
	if (npm === '@ai-sdk/baseten') return 'openai-compatible';
	if (npm === '@ai-sdk/huggingface') return 'openai-compatible';
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
	return getProviderModels(provider)[model];
}

function getProviderModels(provider: ProviderId): ModelInfoMap {
	const catalogProvider = resolveBuiltInProviderCatalogId(provider);
	const catalogModels = catalogProvider
		? catalog[catalogProvider]?.models
		: undefined;
	const cachedModels = getCachedProviderCatalogEntry(
		catalogProvider ?? provider,
	)?.models;
	const models = mergeModelMaps(catalogModels, cachedModels);
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
