export type ProviderCompatibility =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'openrouter'
	| 'ollama'
	| 'openai-compatible';

export type ProviderPromptFamily =
	| 'default'
	| 'anthropic'
	| 'openai'
	| 'google'
	| 'kimi'
	| 'minimax'
	| 'glm'
	| 'openai-compatible';

export type ProviderRuntimeKind =
	| 'openai'
	| 'anthropic'
	| 'google'
	| 'meta'
	| 'ollama'
	| 'baseten'
	| 'huggingface'
	| 'wafer'
	| 'openrouter'
	| 'opencode'
	| 'copilot-oauth'
	| 'ottorouter'
	| 'xai-proxy'
	| 'zai'
	| 'zai-coding'
	| 'deepseek'
	| 'kimi-oauth'
	| 'minimax';

export type BuiltInProviderDescriptor = {
	id: string;
	defaultEnabled: boolean;
	defaultBaseURL?: string;
	environment: {
		primary: string;
		aliases?: readonly string[];
	};
	compatibility: ProviderCompatibility;
	promptFamily: ProviderPromptFamily;
	allowAnyModel: boolean;
	runtimeKind: ProviderRuntimeKind;
};

export const BUILT_IN_PROVIDER_DESCRIPTORS = {
	openai: {
		id: 'openai',
		defaultEnabled: false,
		environment: { primary: 'OPENAI_API_KEY' },
		compatibility: 'openai',
		promptFamily: 'openai',
		allowAnyModel: false,
		runtimeKind: 'openai',
	},
	anthropic: {
		id: 'anthropic',
		defaultEnabled: false,
		environment: { primary: 'ANTHROPIC_API_KEY' },
		compatibility: 'anthropic',
		promptFamily: 'anthropic',
		allowAnyModel: false,
		runtimeKind: 'anthropic',
	},
	google: {
		id: 'google',
		defaultEnabled: false,
		environment: {
			primary: 'GOOGLE_GENERATIVE_AI_API_KEY',
			aliases: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
		},
		compatibility: 'google',
		promptFamily: 'google',
		allowAnyModel: false,
		runtimeKind: 'google',
	},
	meta: {
		id: 'meta',
		defaultEnabled: false,
		defaultBaseURL: 'https://api.meta.ai/v1',
		environment: { primary: 'META_MODEL_API_KEY' },
		compatibility: 'openai',
		promptFamily: 'openai',
		allowAnyModel: false,
		runtimeKind: 'meta',
	},
	'ollama-cloud': {
		id: 'ollama-cloud',
		defaultEnabled: false,
		defaultBaseURL: 'https://ollama.com',
		environment: { primary: 'OLLAMA_API_KEY' },
		compatibility: 'ollama',
		promptFamily: 'openai-compatible',
		allowAnyModel: true,
		runtimeKind: 'ollama',
	},
	baseten: {
		id: 'baseten',
		defaultEnabled: false,
		defaultBaseURL: 'https://inference.baseten.co/v1',
		environment: { primary: 'BASETEN_API_KEY' },
		compatibility: 'openai-compatible',
		promptFamily: 'openai-compatible',
		allowAnyModel: true,
		runtimeKind: 'baseten',
	},
	huggingface: {
		id: 'huggingface',
		defaultEnabled: false,
		defaultBaseURL: 'https://router.huggingface.co/v1',
		environment: {
			primary: 'HF_TOKEN',
			aliases: ['HUGGINGFACE_API_KEY'],
		},
		compatibility: 'openai-compatible',
		promptFamily: 'openai-compatible',
		allowAnyModel: true,
		runtimeKind: 'huggingface',
	},
	wafer: {
		id: 'wafer',
		defaultEnabled: false,
		defaultBaseURL: 'https://pass.wafer.ai/v1',
		environment: { primary: 'WAFER_API_KEY' },
		compatibility: 'openai-compatible',
		promptFamily: 'openai-compatible',
		allowAnyModel: false,
		runtimeKind: 'wafer',
	},
	openrouter: {
		id: 'openrouter',
		defaultEnabled: false,
		defaultBaseURL: 'https://openrouter.ai/api/v1',
		environment: { primary: 'OPENROUTER_API_KEY' },
		compatibility: 'openrouter',
		promptFamily: 'openai-compatible',
		allowAnyModel: false,
		runtimeKind: 'openrouter',
	},
	opencode: {
		id: 'opencode',
		defaultEnabled: false,
		defaultBaseURL: 'https://opencode.ai/zen/v1',
		environment: { primary: 'OPENCODE_API_KEY' },
		compatibility: 'openai-compatible',
		promptFamily: 'openai-compatible',
		allowAnyModel: false,
		runtimeKind: 'opencode',
	},
	copilot: {
		id: 'copilot',
		defaultEnabled: false,
		defaultBaseURL: 'https://api.githubcopilot.com',
		environment: {
			primary: 'GITHUB_TOKEN',
			aliases: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN'],
		},
		compatibility: 'openai',
		promptFamily: 'openai',
		allowAnyModel: false,
		runtimeKind: 'copilot-oauth',
	},
	ottorouter: {
		id: 'ottorouter',
		defaultEnabled: true,
		defaultBaseURL: 'https://api.ottorouter.org/v1',
		environment: {
			primary: 'OTTOROUTER_OAUTH',
			aliases: ['OTTOROUTER_PRIVATE_KEY'],
		},
		compatibility: 'openrouter',
		promptFamily: 'openai-compatible',
		allowAnyModel: false,
		runtimeKind: 'ottorouter',
	},
	xai: {
		id: 'xai',
		defaultEnabled: false,
		environment: { primary: 'XAI_API_KEY' },
		compatibility: 'openai',
		promptFamily: 'openai',
		allowAnyModel: false,
		runtimeKind: 'xai-proxy',
	},
	zai: {
		id: 'zai',
		defaultEnabled: false,
		defaultBaseURL: 'https://api.z.ai/api/paas/v4',
		environment: {
			primary: 'ZAI_API_KEY',
			aliases: ['ZHIPU_API_KEY'],
		},
		compatibility: 'openai-compatible',
		promptFamily: 'glm',
		allowAnyModel: false,
		runtimeKind: 'zai',
	},
	'zai-coding': {
		id: 'zai-coding',
		defaultEnabled: false,
		defaultBaseURL: 'https://api.z.ai/api/coding/paas/v4',
		environment: { primary: 'ZAI_CODING_API_KEY' },
		compatibility: 'openai-compatible',
		promptFamily: 'glm',
		allowAnyModel: false,
		runtimeKind: 'zai-coding',
	},
	deepseek: {
		id: 'deepseek',
		defaultEnabled: false,
		defaultBaseURL: 'https://api.deepseek.com',
		environment: { primary: 'DEEPSEEK_API_KEY' },
		compatibility: 'openai-compatible',
		promptFamily: 'openai-compatible',
		allowAnyModel: false,
		runtimeKind: 'deepseek',
	},
	kimi: {
		id: 'kimi',
		defaultEnabled: false,
		defaultBaseURL: 'https://api.moonshot.ai/v1',
		environment: {
			primary: 'KIMI_API_KEY',
			aliases: ['MOONSHOT_API_KEY'],
		},
		compatibility: 'openai-compatible',
		promptFamily: 'kimi',
		allowAnyModel: false,
		runtimeKind: 'kimi-oauth',
	},
	minimax: {
		id: 'minimax',
		defaultEnabled: false,
		defaultBaseURL: 'https://api.minimax.io/anthropic/v1',
		environment: { primary: 'MINIMAX_API_KEY' },
		compatibility: 'anthropic',
		promptFamily: 'minimax',
		allowAnyModel: false,
		runtimeKind: 'minimax',
	},
} as const satisfies Record<string, BuiltInProviderDescriptor>;

export type BuiltInProviderId = keyof typeof BUILT_IN_PROVIDER_DESCRIPTORS;

export const builtInProviderIds = Object.keys(
	BUILT_IN_PROVIDER_DESCRIPTORS,
) as BuiltInProviderId[];

export function getBuiltInProviderDescriptor(
	provider: BuiltInProviderId,
): (typeof BUILT_IN_PROVIDER_DESCRIPTORS)[BuiltInProviderId] {
	return BUILT_IN_PROVIDER_DESCRIPTORS[provider];
}
