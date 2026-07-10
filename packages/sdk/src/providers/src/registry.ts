import { catalog } from './catalog-merged.ts';
import { providerEnvVar, readEnvKey } from './env.ts';
import { getCachedProviderCatalogEntry } from './model-catalog-cache.ts';
import { mapConfiguredModelEntries, modelMapToList } from './model-map.ts';
import { mergeModelMaps } from './model-merge.ts';
import {
	getUnderlyingProviderKey,
	providerIds,
	selectFastModel,
	type FastModelAuthType,
} from './utils.ts';
import type {
	BuiltInProviderId,
	OttoConfig,
	ProviderCompatibility,
	ProviderId,
	ProviderPromptFamily,
	ProviderSettingsEntry,
	ModelInfoMap,
} from '../../types/src/index.ts';

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

const BUILTIN_COMPATIBILITY: Record<BuiltInProviderId, ProviderCompatibility> =
	{
		openai: 'openai',
		anthropic: 'anthropic',
		google: 'google',
		meta: 'openai',
		'ollama-cloud': 'ollama',
		baseten: 'openai-compatible',
		huggingface: 'openai-compatible',
		wafer: 'openai-compatible',
		openrouter: 'openrouter',
		opencode: 'openai-compatible',
		copilot: 'openai',
		ottorouter: 'openrouter',
		xai: 'openai',
		zai: 'openai-compatible',
		'zai-coding': 'openai-compatible',
		deepseek: 'openai-compatible',
		kimi: 'openai-compatible',
		minimax: 'anthropic',
	};

const BUILTIN_FAMILY: Record<BuiltInProviderId, ProviderPromptFamily> = {
	openai: 'openai',
	anthropic: 'anthropic',
	google: 'google',
	meta: 'openai',
	'ollama-cloud': 'openai-compatible',
	baseten: 'openai-compatible',
	huggingface: 'openai-compatible',
	wafer: 'openai-compatible',
	openrouter: 'openai-compatible',
	opencode: 'openai-compatible',
	copilot: 'openai',
	ottorouter: 'openai-compatible',
	xai: 'openai',
	zai: 'glm',
	'zai-coding': 'glm',
	deepseek: 'openai-compatible',
	kimi: 'kimi',
	minimax: 'minimax',
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
			compatibility: BUILTIN_COMPATIBILITY[catalogProvider],
			family: BUILTIN_FAMILY[catalogProvider],
			baseURL: normalizeOptionalText(resolvedSettings?.baseURL) ?? entry.api,
			apiKey: normalizeOptionalText(resolvedSettings?.apiKey),
			apiKeyEnv:
				normalizeOptionalText(resolvedSettings?.apiKeyEnv) ??
				providerEnvVar(provider),
			models,
			allowAnyModel:
				catalogProvider === 'ollama-cloud' ||
				catalogProvider === 'baseten' ||
				catalogProvider === 'huggingface',
		};
	}

	if (!settings?.custom) return undefined;
	const cachedEntry = getCachedProviderCatalogEntry(provider);
	const configuredModels = normalizeConfiguredModels(settings.models);
	const models = cachedEntry?.models ?? configuredModels;
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
	if (definition.source === 'custom') return definition.family;
	const catalogProvider = resolveBuiltInProviderCatalogId(provider);
	if (catalogProvider) {
		return (
			getUnderlyingProviderKey(catalogProvider, model) ?? definition.family
		);
	}
	return definition.family;
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
	if (provider === 'kimi') {
		const envValue = readEnvKey(provider);
		if (envValue?.length) return envValue;
	}
	if (definition.apiKeyEnv?.length) {
		const value = process.env[definition.apiKeyEnv];
		if (value?.length) return value;
	}
	return undefined;
}
