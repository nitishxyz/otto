import { catalog } from './catalog-merged.ts';
import { providerEnvVar, readEnvKey } from './env.ts';
import { getCachedProviderCatalogEntry } from './model-catalog-cache.ts';
import { mapConfiguredModelEntries, modelMapToList } from './model-map.ts';
import { mergeModelMaps } from './model-merge.ts';
import {
	getModelPromptFamily,
	getModelProviderCompatibility,
	getUnderlyingProviderKey,
	providerIds,
	selectFastModel,
	type FastModelAuthType,
} from './utils.ts';
import type {
	BuiltInProviderId,
	BuiltInProviderDescriptor,
	OttoConfig,
	ProviderCompatibility,
	ProviderId,
	ProviderPromptFamily,
	ProviderSettingsEntry,
	ModelInfoMap,
} from '../../types/src/index.ts';
import { BUILT_IN_PROVIDER_DESCRIPTORS } from '../../types/src/provider-descriptors.ts';

export type ResolvedProviderDefinition = {
	id: ProviderId;
	label: string;
	source: 'built-in' | 'custom';
	compatibility: ProviderCompatibility;
	family: ProviderPromptFamily;
	baseURL?: string;
	apiKey?: string;
	apiKeyEnv?: string;
	models: ModelInfoMap;
	allowAnyModel: boolean;
};

function normalizeOptionalText(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
		return undefined;
	}
	return trimmed;
}

function normalizeConfiguredModels(
	models: ProviderSettingsEntry['models'] | undefined,
): ModelInfoMap {
	return mapConfiguredModelEntries(models);
}

function applyConfiguredModelBindings(
	models: ModelInfoMap,
	configuredModels: ModelInfoMap,
): ModelInfoMap {
	return Object.fromEntries(
		Object.entries(models).map(([id, model]) => [
			id,
			{ ...configuredModels[id], ...model, id },
		]),
	);
}

function resolveCustomCompatibility(
	settings: ProviderSettingsEntry,
): ProviderCompatibility {
	return settings.compatibility ?? 'openai-compatible';
}

function resolveCustomFamily(
	settings: ProviderSettingsEntry,
): ProviderPromptFamily {
	return settings.family ?? 'default';
}

function isCatalogBuiltInProviderId(
	value: unknown,
): value is BuiltInProviderId {
	return (
		typeof value === 'string' &&
		providerIds.includes(value as BuiltInProviderId)
	);
}

export function resolveBuiltInProviderCatalogId(
	provider: ProviderId,
): BuiltInProviderId | undefined {
	if (isCatalogBuiltInProviderId(provider)) return provider;
	return undefined;
}

export function isBuiltInProviderId(
	value: unknown,
): value is BuiltInProviderId {
	return isCatalogBuiltInProviderId(value);
}

export function getProviderSettings(
	cfg: OttoConfig,
	provider: ProviderId,
): ProviderSettingsEntry | undefined {
	return cfg.providers[String(provider)];
}

export function getProviderDefinition(
	cfg: OttoConfig,
	provider: ProviderId,
): ResolvedProviderDefinition | undefined {
	const settings = getProviderSettings(cfg, provider);
	const catalogProvider = resolveBuiltInProviderCatalogId(provider);
	if (catalogProvider) {
		const descriptor: BuiltInProviderDescriptor =
			BUILT_IN_PROVIDER_DESCRIPTORS[catalogProvider];
		const entry = catalog[catalogProvider];
		if (!entry) return undefined;
		const cachedEntry = getCachedProviderCatalogEntry(catalogProvider);
		const models = mergeModelMaps(entry.models, cachedEntry?.models);
		const resolvedSettings = settings;
		return {
			id: provider,
			label:
				resolvedSettings?.label ??
				cachedEntry?.label ??
				entry.label ??
				provider,
			source: 'built-in',
			compatibility: descriptor.compatibility,
			family: descriptor.promptFamily,
			baseURL:
				normalizeOptionalText(resolvedSettings?.baseURL) ??
				descriptor.defaultBaseURL,
			apiKey: normalizeOptionalText(resolvedSettings?.apiKey),
			apiKeyEnv:
				normalizeOptionalText(resolvedSettings?.apiKeyEnv) ??
				providerEnvVar(provider),
			models,
			allowAnyModel: descriptor.allowAnyModel,
		};
	}

	if (!settings?.custom) return undefined;
	const cachedEntry = getCachedProviderCatalogEntry(provider);
	const configuredModels = normalizeConfiguredModels(settings.models);
	const models = cachedEntry?.models
		? applyConfiguredModelBindings(cachedEntry.models, configuredModels)
		: configuredModels;
	return {
		id: provider,
		label: settings.label ?? cachedEntry?.label ?? provider,
		source: 'custom',
		compatibility: resolveCustomCompatibility(settings),
		family: resolveCustomFamily(settings),
		baseURL: normalizeOptionalText(settings.baseURL),
		apiKey: normalizeOptionalText(settings.apiKey),
		apiKeyEnv: normalizeOptionalText(settings.apiKeyEnv),
		models,
		allowAnyModel:
			settings.allowAnyModel === true || Object.keys(models).length === 0,
	};
}

export function hasConfiguredProvider(
	cfg: OttoConfig,
	provider: ProviderId | undefined,
): provider is ProviderId {
	if (!provider || typeof provider !== 'string') return false;
	const definition = getProviderDefinition(cfg, provider);
	if (!definition) return false;
	if (definition.source === 'built-in') return true;
	return getProviderSettings(cfg, provider)?.enabled !== false;
}

export function getConfiguredProviderIds(
	cfg: OttoConfig,
	options?: { includeDisabled?: boolean },
): ProviderId[] {
	const includeDisabled = options?.includeDisabled === true;
	const ids = new Set<ProviderId>([
		...providerIds,
		...Object.keys(cfg.providers),
		cfg.defaults.provider,
	]);
	return Array.from(ids).filter((provider) => {
		const definition = getProviderDefinition(cfg, provider);
		if (!definition) return false;
		if (definition.source === 'built-in') return true;
		if (includeDisabled) return true;
		return getProviderSettings(cfg, provider)?.enabled !== false;
	});
}

export function getConfiguredProviderModels(
	cfg: OttoConfig,
	provider: ProviderId,
): ModelInfoMap {
	return getProviderDefinition(cfg, provider)?.models ?? {};
}

export function getConfiguredProviderDefaultModel(
	cfg: OttoConfig,
	provider: ProviderId,
): string | undefined {
	return modelMapToList(getConfiguredProviderModels(cfg, provider))[0]?.id;
}

export function getConfiguredFastModelForAuth(
	cfg: OttoConfig,
	provider: ProviderId,
	authType: FastModelAuthType,
): string | undefined {
	const definition = getProviderDefinition(cfg, provider);
	if (!definition) return undefined;
	const configuredFastModels = getProviderSettings(cfg, provider)?.fastModels;
	if (
		!configuredFastModels?.length &&
		(definition.source === 'custom' || definition.compatibility === 'ollama')
	) {
		return undefined;
	}
	return selectFastModel(provider, definition.models, {
		authType,
		configuredFastModels,
		allowAnyModel: definition.allowAnyModel,
		useBuiltInPreferred: definition.source === 'built-in',
	});
}

export function providerAllowsAnyModel(
	cfg: OttoConfig,
	provider: ProviderId,
): boolean {
	return getProviderDefinition(cfg, provider)?.allowAnyModel === true;
}

export function hasConfiguredModel(
	cfg: OttoConfig,
	provider: ProviderId,
	model: string | undefined,
): boolean {
	if (!model) return false;
	const definition = getProviderDefinition(cfg, provider);
	if (!definition) return false;
	if (definition.allowAnyModel) return model.trim().length > 0;
	return definition.models[model] !== undefined;
}

export function getConfiguredProviderFamily(
	cfg: OttoConfig,
	provider: ProviderId,
	model: string,
): ProviderPromptFamily | null {
	const definition = getProviderDefinition(cfg, provider);
	if (!definition) return null;
	if (definition.source === 'custom') {
		return getModelPromptFamily(definition.models[model], definition.family);
	}
	const catalogProvider = resolveBuiltInProviderCatalogId(provider);
	if (catalogProvider) {
		return (
			getUnderlyingProviderKey(catalogProvider, model) ?? definition.family
		);
	}
	return definition.family;
}

export function getConfiguredModelCompatibility(
	cfg: OttoConfig,
	provider: ProviderId,
	model: string,
): ProviderCompatibility | null {
	const definition = getProviderDefinition(cfg, provider);
	if (!definition) return null;
	return getModelProviderCompatibility(
		definition.models[model],
		definition.compatibility,
	);
}

export function getConfiguredProviderEnvVar(
	cfg: OttoConfig,
	provider: ProviderId,
): string | undefined {
	const definition = getProviderDefinition(cfg, provider);
	return definition?.apiKeyEnv;
}

export function getConfiguredProviderApiKey(
	cfg: OttoConfig,
	provider: ProviderId,
): string | undefined {
	const definition = getProviderDefinition(cfg, provider);
	if (!definition) return undefined;
	if (definition.apiKey?.length) return definition.apiKey;
	const configuredApiKeyEnv = normalizeOptionalText(
		getProviderSettings(cfg, provider)?.apiKeyEnv,
	);
	if (configuredApiKeyEnv) {
		const value = process.env[configuredApiKeyEnv];
		return value?.length ? value : undefined;
	}
	if (definition.source === 'built-in') {
		const envValue = readEnvKey(provider);
		if (envValue?.length) return envValue;
	}
	if (definition.apiKeyEnv?.length) {
		const value = process.env[definition.apiKeyEnv];
		if (value?.length) return value;
	}
	return undefined;
}
