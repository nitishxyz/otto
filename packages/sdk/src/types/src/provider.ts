import type {
	BuiltInProviderId,
	ProviderCompatibility,
	ProviderPromptFamily,
} from './provider-descriptors.ts';

export type {
	BuiltInProviderId,
	ProviderCompatibility,
	ProviderPromptFamily,
} from './provider-descriptors.ts';

/**
 * Provider identifiers may be built-in or custom/config-defined.
 */
export type ProviderId = BuiltInProviderId | (string & {});

/**
 * Provider family for prompt selection
 */
export type ProviderFamily =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'kimi'
	| 'minimax'
	| 'openai-compatible';

/**
 * The upstream provider that owns/created the model.
 * Used for API format routing, system prompt selection, and provider detection.
 */
export type ModelOwner =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'meta'
	| 'openrouter'
	| 'xai'
	| 'kimi'
	| 'qwen'
	| 'zai'
	| 'deepseek'
	| 'minimax';

export type ModelProviderBinding = {
	id?: string;
	npm?: string;
	/** Explicit transport override. Known npm bindings are also inferred. */
	compatibility?: ProviderCompatibility;
	api?: string;
	baseURL?: string;
	/**
	 * The provider family for prompt selection.
	 * Used to determine which base prompt to use for this model.
	 */
	family?: ProviderPromptFamily;
};

export type ModelAuthType = 'api' | 'oauth';

/**
 * Information about a specific model
 */
export type ModelInfo = {
	id: string;
	/**
	 * Authentication methods that can access this model. An omitted value keeps
	 * older catalogs and custom providers compatible by allowing either method.
	 */
	auth?: ModelAuthType[];
	ownedBy?: ModelOwner;
	label?: string;
	modalities?: { input?: string[]; output?: string[] };
	toolCall?: boolean;
	reasoningText?: boolean;
	attachment?: boolean;
	/**
	 * Editing tool policy override for this model.
	 * Use structured for lower-end models that handle simple edit schemas better
	 * than free-form patch languages.
	 */
	editToolCapability?: 'structured' | 'patch';
	temperature?: boolean | number;
	knowledge?: string;
	releaseDate?: string;
	lastUpdated?: string;
	openWeights?: boolean;
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	limit?: { context?: number; output?: number };
	provider?: ModelProviderBinding;
};

export type ModelInfoMap = Record<string, ModelInfo>;

export type ProviderCatalogEntry = {
	id: BuiltInProviderId;
	label?: string;
	env?: string[];
	npm?: string;
	api?: string;
	doc?: string;
	models: ModelInfoMap;
};
