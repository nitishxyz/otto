import type {
	BuiltInProviderId,
	ModelAuthType,
	ModelInfo,
	ProviderCatalogEntry,
} from '../../types/src/index.ts';

type CatalogMap = Partial<Record<BuiltInProviderId, ProviderCatalogEntry>>;

const API_AUTH = ['api'] as const satisfies readonly ModelAuthType[];
const BOTH_AUTH = ['api', 'oauth'] as const satisfies readonly ModelAuthType[];

const DEFAULT_AUTH: Partial<
	Record<BuiltInProviderId, readonly ModelAuthType[]>
> = {
	openai: API_AUTH,
	anthropic: API_AUTH,
	xai: API_AUTH,
};

const OAUTH_MODEL_IDS: Partial<Record<BuiltInProviderId, ReadonlySet<string>>> =
	{
		openai: new Set([
			'gpt-5.1-codex',
			'gpt-5.1-codex-max',
			'gpt-5.1-codex-mini',
			'gpt-5.2',
			'gpt-5.2-codex',
			'gpt-5.3-codex',
			'gpt-5.4',
			'gpt-5.4-mini',
			'gpt-5.5',
			'gpt-5.6',
			'gpt-5.6-luna',
			'gpt-5.6-sol',
			'gpt-5.6-terra',
		]),
		xai: new Set(['grok-4.5']),
	};

const OAUTH_MODEL_PREFIXES: Partial<
	Record<BuiltInProviderId, readonly string[]>
> = {
	anthropic: [
		'claude-fable-5',
		'claude-haiku-4-5',
		'claude-opus-4-5',
		'claude-opus-4-6',
		'claude-opus-4-7',
		'claude-opus-4-8',
		'claude-opus-5',
		'claude-sonnet-4-5',
		'claude-sonnet-4-6',
		'claude-sonnet-5',
	],
};

const MODEL_AUTH_OVERRIDES: Partial<
	Record<BuiltInProviderId, Record<string, readonly ModelAuthType[]>>
> = {
	xai: {
		// Retained for model metadata and direct configuration, but not advertised.
		'grok-build': [],
		'grok-composer-2.5-fast': ['oauth'],
	},
};

function resolveModelAuth(
	provider: BuiltInProviderId,
	model: ModelInfo,
): readonly ModelAuthType[] | undefined {
	if (model.auth !== undefined) return model.auth;
	const override = MODEL_AUTH_OVERRIDES[provider]?.[model.id];
	if (override !== undefined) return override;
	if (OAUTH_MODEL_IDS[provider]?.has(model.id)) return BOTH_AUTH;
	if (
		OAUTH_MODEL_PREFIXES[provider]?.some((prefix) =>
			model.id.startsWith(prefix),
		)
	)
		return BOTH_AUTH;
	return DEFAULT_AUTH[provider];
}

/** Materialize model authentication availability into catalog entries. */
export function applyCatalogModelAuth<T extends CatalogMap>(catalog: T): T {
	for (const [providerValue, entry] of Object.entries(catalog)) {
		if (!entry) continue;
		const provider = providerValue as BuiltInProviderId;
		for (const [modelId, model] of Object.entries(entry.models)) {
			const auth = resolveModelAuth(provider, model);
			if (auth === undefined) continue;
			entry.models[modelId] = { ...model, auth: [...auth] };
		}
	}
	return catalog;
}
