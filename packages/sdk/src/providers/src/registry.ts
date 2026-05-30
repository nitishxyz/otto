import { catalog } from './catalog-merged.ts';
import { providerEnvVar } from './env.ts';
import { getCachedProviderCatalogEntry } from './model-catalog-cache.ts';
import { getUnderlyingProviderKey, providerIds } from './utils.ts';
import type {
	BuiltInProviderId,
	ModelInfo,
	OttoConfig,
	ProviderCompatibility,
	ProviderId,
	ProviderPromptFamily,
	ProviderSettingsEntry,
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
	models: ModelInfo[];
	allowAnyModel: boolean;
};

const BUILTIN_COMPATIBILITY: Record<BuiltInProviderId, ProviderCompatibility> =
	{
		openai: 'openai',
		anthropic: 'anthropic',
		google: 'google',
		'ollama-cloud': 'ollama',
		openrouter: 'openrouter',
		opencode: 'openai-compatible',
		copilot: 'openai',
		ottorouter: 'openrouter',
		xai: 'openai',
		zai: 'openai-compatible',
		'zai-coding': 'openai-compatible',
		moonshot: 'openai-compatible',
		minimax: 'anthropic',
	};

const BUILTIN_FAMILY: Record<BuiltInProviderId, ProviderPromptFamily> = {
	openai: 'openai',
	anthropic: 'anthropic',
	google: 'google',
	'ollama-cloud': 'openai-compatible',
	openrouter: 'openai-compatible',
	opencode: 'openai-compatible',
	copilot: 'openai',
	ottorouter: 'openai-compatible',
	xai: 'openai',
	zai: 'glm',
	'zai-coding': 'glm',
	moonshot: 'moonshot',
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
): ModelInfo[] {
	if (!models) return [];
	return models
		.map((model): ModelInfo | null => {
			if (typeof model === 'string') {
				const id = model.trim();
				return id ? { id, label: id } : null;
			}
			const id = normalizeOptionalText(model.id);
			return id ? { ...model, id, label: model.label ?? id } : null;
		})
		.filter((model): model is ModelInfo => model !== null);
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

export function isBuiltInProviderId(
	value: unknown,
): value is BuiltInProviderId {
	return (
		typeof value === 'string' &&
		providerIds.includes(value as BuiltInProviderId)
	);
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
	if (isBuiltInProviderId(provider)) {
		const entry = catalog[provider];
		if (!entry) return undefined;
		const cachedEntry = getCachedProviderCatalogEntry(provider);
		const models = cachedEntry?.models ?? entry.models;
		return {
			id: provider,
			label: settings?.label ?? cachedEntry?.label ?? entry.label ?? provider,
			source: 'built-in',
			compatibility: BUILTIN_COMPATIBILITY[provider],
			family: BUILTIN_FAMILY[provider],
			baseURL: normalizeOptionalText(settings?.baseURL) ?? entry.api,
			apiKey: normalizeOptionalText(settings?.apiKey),
			apiKeyEnv:
				normalizeOptionalText(settings?.apiKeyEnv) ?? providerEnvVar(provider),
			models,
			allowAnyModel: provider === 'ollama-cloud',
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
		allowAnyModel: settings.allowAnyModel === true || models.length === 0,
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
): ModelInfo[] {
	return getProviderDefinition(cfg, provider)?.models ?? [];
}

export function getConfiguredProviderDefaultModel(
	cfg: OttoConfig,
	provider: ProviderId,
): string | undefined {
	return getConfiguredProviderModels(cfg, provider)[0]?.id;
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
	return definition.models.some((entry) => entry.id === model);
}

export function getConfiguredProviderFamily(
	cfg: OttoConfig,
	provider: ProviderId,
	model: string,
): ProviderPromptFamily | null {
	const definition = getProviderDefinition(cfg, provider);
	if (!definition) return null;
	if (definition.source === 'custom') return definition.family;
	if (isBuiltInProviderId(provider)) {
		return getUnderlyingProviderKey(provider, model) ?? definition.family;
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
	if (definition.apiKeyEnv?.length) {
		const value = process.env[definition.apiKeyEnv];
		if (value?.length) return value;
	}
	return undefined;
}
