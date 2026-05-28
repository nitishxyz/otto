import type { ProviderId, ModelInfo } from '../../types/src/index.ts';

const OAUTH_MODEL_PREFIXES: Partial<Record<ProviderId, string[]>> = {
	anthropic: [
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

function matchesOAuthModel(provider: ProviderId, modelId: string): boolean {
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
	models: ModelInfo[],
	authType: 'api' | 'oauth' | 'wallet' | undefined,
): ModelInfo[] {
	if (authType !== 'oauth') return models;
	const exactIds = OAUTH_MODEL_IDS[provider];
	const prefixes = OAUTH_MODEL_PREFIXES[provider];
	if (!exactIds && !prefixes) return models;
	return models.filter((model) => matchesOAuthModel(provider, model.id));
}

export function getOAuthModelPrefixes(
	provider: ProviderId,
): string[] | undefined {
	return OAUTH_MODEL_PREFIXES[provider] ?? OAUTH_MODEL_IDS[provider];
}
