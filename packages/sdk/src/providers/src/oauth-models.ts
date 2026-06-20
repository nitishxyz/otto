import type { ProviderId, ModelInfoMap } from '../../types/src/index.ts';

const OAUTH_MODEL_PREFIXES: Partial<Record<ProviderId, string[]>> = {
	anthropic: [
		'claude-fable-5',
		'claude-haiku-4-5',
		'claude-opus-4-5',
		'claude-opus-4-6',
		'claude-opus-4-7',
		'claude-opus-4-8',
		'claude-sonnet-4-5',
		'claude-sonnet-4-6',
	],
};

const OAUTH_MODEL_IDS: Partial<Record<ProviderId, string[]>> = {
	openai: [
		'gpt-5.1-codex',
		'gpt-5.1-codex-max',
		'gpt-5.1-codex-mini',
		'gpt-5.2',
		'gpt-5.2-codex',
		'gpt-5.3-codex',
		'gpt-5.4',
		'gpt-5.4-mini',
		'gpt-5.5',
	],
};

const OAUTH_ONLY_MODEL_IDS: Partial<Record<ProviderId, string[]>> = {
	xai: ['grok-build', 'grok-composer-2.5-fast'],
};

function isOAuthOnlyModel(provider: ProviderId, modelId: string): boolean {
	return OAUTH_ONLY_MODEL_IDS[provider]?.includes(modelId) === true;
}

function matchesOAuthModel(provider: ProviderId, modelId: string): boolean {
	if (isOAuthOnlyModel(provider, modelId)) return true;

	const exactIds = OAUTH_MODEL_IDS[provider];
	if (exactIds?.includes(modelId)) return true;

	const prefixes = OAUTH_MODEL_PREFIXES[provider];
	if (prefixes?.some((prefix) => modelId.startsWith(prefix))) return true;

	return !exactIds && !prefixes;
}

export function isModelAllowedForOAuth(
	provider: ProviderId,
	modelId: string,
): boolean {
	return matchesOAuthModel(provider, modelId);
}

export function filterModelsForAuthType(
	provider: ProviderId,
	models: ModelInfoMap,
	authType: 'api' | 'oauth' | 'wallet' | undefined,
): ModelInfoMap {
	const filtered: ModelInfoMap = {};
	if (authType !== 'oauth') {
		for (const [id, model] of Object.entries(models)) {
			if (!isOAuthOnlyModel(provider, id)) filtered[id] = model;
		}
		return filtered;
	}
	const exactIds = OAUTH_MODEL_IDS[provider];
	const prefixes = OAUTH_MODEL_PREFIXES[provider];
	if (!exactIds && !prefixes) return models;
	for (const [id, model] of Object.entries(models)) {
		if (matchesOAuthModel(provider, id)) filtered[id] = model;
	}
	return filtered;
}

export function getOAuthModelPrefixes(
	provider: ProviderId,
): string[] | undefined {
	return OAUTH_MODEL_PREFIXES[provider] ?? OAUTH_MODEL_IDS[provider];
}
