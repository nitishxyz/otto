import { catalog } from './catalog-merged.ts';
import { modelMapToList } from './model-map.ts';
import { getCachedProviderCatalogEntry } from './model-catalog-cache.ts';
import { mergeModelMaps } from './model-merge.ts';
import type { OttoConfig, ProviderId } from '../../types/src/index.ts';
import {
	getProviderDefinition,
	hasConfiguredModel,
	providerAllowsAnyModel,
	resolveBuiltInProviderCatalogId,
} from './registry.ts';

export type CapabilityRequest = {
	wantsToolCalls?: boolean;
	wantsVision?: boolean; // input image
	allowUnknownModel?: boolean;
};

export function validateProviderModel(
	provider: string,
	model: string,
	cfgOrCap?: OttoConfig | CapabilityRequest,
	cap?: CapabilityRequest,
) {
	const providerId = provider.trim() as ProviderId;
	const modelId = model.trim();
	const cfg = isOttoConfigLike(cfgOrCap) ? cfgOrCap : undefined;
	const effectiveCap = isOttoConfigLike(cfgOrCap) ? cap : cfgOrCap;

	if (cfg) {
		const definition = getProviderDefinition(cfg, providerId);
		const cachedModels =
			getCachedProviderCatalogEntry(
				resolveBuiltInProviderCatalogId(providerId) ?? providerId,
			)?.models ?? {};
		if (!definition) {
			if (!Object.keys(cachedModels).length) {
				throw new Error(`Provider not supported: ${providerId}`);
			}
			const entry = cachedModels[modelId];
			if (!entry) {
				throwModelNotFound(providerId, modelId, modelMapToList(cachedModels));
			}
			applyCapabilityValidation(modelId, entry, effectiveCap, {
				strict: false,
			});
			return;
		}
		if (
			!effectiveCap?.allowUnknownModel &&
			!providerAllowsAnyModel(cfg, providerId)
		) {
			const knownModels = Object.keys(definition.models).length
				? modelMapToList(definition.models)
				: modelMapToList(cachedModels);
			const hasModel =
				hasConfiguredModel(cfg, providerId, modelId) ||
				cachedModels[modelId] !== undefined;
			if (!hasModel) {
				throwModelNotFound(providerId, modelId, knownModels);
			}
		}

		const entry = definition.models[modelId] ?? cachedModels[modelId];
		if (entry) {
			applyCapabilityValidation(modelId, entry, effectiveCap, {
				strict: definition.source !== 'custom',
			});
		}
		return;
	}

	const p = providerId;
	const catalogProvider = resolveBuiltInProviderCatalogId(p);
	const builtInEntry = catalogProvider ? catalog[catalogProvider] : undefined;
	const cachedEntry = getCachedProviderCatalogEntry(catalogProvider ?? p);
	if (!builtInEntry && !cachedEntry) {
		throw new Error(`Provider not supported: ${providerId}`);
	}
	const models = mergeModelMaps(builtInEntry?.models, cachedEntry?.models);
	const entry = models[modelId];
	if (!entry) {
		throwModelNotFound(providerId, modelId, modelMapToList(models));
	}
	applyCapabilityValidation(modelId, entry, effectiveCap, { strict: true });
}

function throwModelNotFound(
	provider: ProviderId,
	model: string,
	models: Array<{ id: string }>,
): never {
	const list = models
		.slice(0, 10)
		.map((m) => m.id)
		.join(', ');
	throw new Error(
		`Model not found for provider ${provider}: ${model}. Example models: ${list}${models.length > 10 ? ', ...' : ''}`,
	);
}

function applyCapabilityValidation(
	model: string,
	entry: {
		toolCall?: boolean;
		modalities?: { input?: string[]; output?: string[] };
	},
	cap: CapabilityRequest | undefined,
	options: { strict: boolean },
) {
	if (cap?.wantsToolCalls && entry.toolCall === false) {
		throw new Error(`Model ${model} does not support tool calls.`);
	}
	if (!options.strict && cap?.wantsToolCalls && entry.toolCall === undefined) {
		return;
	}
	if (cap?.wantsVision) {
		if (!options.strict && !entry.modalities) return;
		const inputs = entry.modalities?.input as string[] | undefined;
		const outputs = entry.modalities?.output as string[] | undefined;
		const ok =
			(inputs ?? []).includes('image') || (outputs ?? []).includes('image');
		if (!ok)
			throw new Error(`Model ${model} does not support vision input/output.`);
	}
}

function isOttoConfigLike(value: unknown): value is OttoConfig {
	return Boolean(
		value &&
			typeof value === 'object' &&
			'defaults' in value &&
			'providers' in value,
	);
}
