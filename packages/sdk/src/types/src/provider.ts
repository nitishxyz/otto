/**
 * Built-in provider identifiers supported directly by otto.
 */
export type BuiltInProviderId =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'ollama-cloud'
	| 'openrouter'
	| 'opencode'
	| 'copilot'
	| 'ottorouter'
	| 'xai'
	| 'zai'
	| 'zai-coding'
	| 'moonshot'
	| 'minimax';

/**
 * Provider identifiers may be built-in or custom/config-defined.
 */
export type ProviderId = BuiltInProviderId | (string & {});

/**
 * Compatibility protocol used to instantiate a provider client.
 */
export type ProviderCompatibility =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'openrouter'
	| 'ollama'
	| 'openai-compatible';

/**
 * Prompt/behavior family used for prompts and provider-specific behavior.
 */
export type ProviderPromptFamily =
	| 'default'
	| 'anthropic'
	| 'openai'
	| 'google'
	| 'moonshot'
	| 'minimax'
	| 'glm'
	| 'openai-compatible';

/**
 * Provider family for prompt selection
 */
export type ProviderFamily =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'moonshot'
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
	| 'openrouter'
	| 'xai'
	| 'moonshot'
	| 'qwen'
	| 'zai'
	| 'minimax';

export type ModelProviderBinding = {
	id?: string;
	npm?: string;
	api?: string;
	baseURL?: string;
	/**
	 * The provider family for prompt selection.
	 * Used to determine which base prompt to use for this model.
	 */
	family?: ProviderFamily;
};

/**
 * Information about a specific model
 */
export type ModelInfo = {
	id: string;
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

export type ProviderCatalogEntry = {
	id: BuiltInProviderId;
	label?: string;
	env?: string[];
	npm?: string;
	api?: string;
	doc?: string;
	models: ModelInfo[];
};
