import type {
	BuiltInProviderId,
	ModelAuthType,
	ModelInfo,
	ModelInfoMap,
	ProviderId,
} from '../../types/src/index.ts';
import { catalog } from './catalog-merged.ts';
import { getCachedProviderCatalogEntry } from './model-catalog-cache.ts';
import { mergeModelMaps } from './model-merge.ts';

const OAUTH_MODEL_CONTEXT_OVERRIDES: Partial<
	Record<ProviderId, Record<string, number>>
> = {
	openai: {
		'gpt-5.5': 264_000,
	},
};

function supportsAuth(model: ModelInfo, authType: ModelAuthType): boolean {
	return model.auth === undefined || model.auth.includes(authType);
}

function applyOAuthContextOverride(
	provider: ProviderId,
	modelId: string,
	model: ModelInfo,
): ModelInfo {
	const context = OAUTH_MODEL_CONTEXT_OVERRIDES[provider]?.[modelId];
	if (context == null) return model;
	return { ...model, limit: { ...model.limit, context } };
}

function getCatalogModels(provider: ProviderId): ModelInfoMap {
	const bundled = catalog[provider as BuiltInProviderId]?.models;
	const cached = getCachedProviderCatalogEntry(provider)?.models;
	return mergeModelMaps(bundled, cached);
}

export function isModelAllowedForOAuth(
	provider: ProviderId,
	modelId: string,
): boolean {
	const models = getCatalogModels(provider);
	const model = models[modelId];
	if (model) return supportsAuth(model, 'oauth');
	return !Object.values(models).some((entry) => entry.auth !== undefined);
}

export function filterModelsForAuthType(
	provider: ProviderId,
	models: ModelInfoMap,
	authType: 'api' | 'oauth' | 'wallet' | undefined,
): ModelInfoMap {
	if (authType !== 'api' && authType !== 'oauth') return { ...models };
	const filtered: ModelInfoMap = {};
	for (const [id, model] of Object.entries(models)) {
		if (!supportsAuth(model, authType)) continue;
		filtered[id] =
			authType === 'oauth'
				? applyOAuthContextOverride(provider, id, model)
				: model;
	}
	return filtered;
}

/** @deprecated Use model `auth` metadata instead of inferring model prefixes. */
export function getOAuthModelPrefixes(
	provider: ProviderId,
): string[] | undefined {
	const models = Object.values(getCatalogModels(provider));
	if (!models.some((model) => model.auth !== undefined)) return undefined;
	return models
		.filter((model) => supportsAuth(model, 'oauth'))
		.map((model) => model.id);
}
