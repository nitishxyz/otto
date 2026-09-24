import type {
	ModelInfoMap,
	ProviderCompatibility,
	ProviderId,
	ProviderPromptFamily,
} from './provider';

/**
 * Configuration scope - where settings are stored
 */
export type Scope = 'global' | 'local';

/**
 * Default settings for the CLI
 */
export type ToolApprovalMode = 'auto' | 'dangerous' | 'all' | 'yolo';
export type ReasoningLevel =
	| 'minimal'
	| 'low'
	| 'medium'
	| 'high'
	| 'max'
	| 'xhigh';

export type DictationKeyword = {
	keyword: string;
	aliases?: string[];
};

export type DefaultConfig = {
	agent: string;
	provider: ProviderId;
	model: string;
	toolApproval?: ToolApprovalMode;
	guidedMode?: boolean;
	reasoningText?: boolean;
	reasoningLevel?: ReasoningLevel;
	theme?: string;
	tuiTheme?: string;
	vimMode?: boolean;
	compactThread?: boolean;
	fontFamily?: string;
	smartEdges?: boolean;
	threadNavigatorRail?: boolean;
	releaseToSend?: boolean;
	fullWidthContent?: boolean;
	notificationsEnabled?: boolean;
	dictationKeywords?: DictationKeyword[];
	dictationExcludedProjectKeywords?: string[];
	dictationSmartFormatting?: boolean;
	autoCompactThresholdTokens?: number | null;
	/** Adds the ottocode bot as a co-author on commits made through Otto. */
	coAuthorCommits?: boolean;
};

export type ProviderSettingsEntry = {
	enabled: boolean;
	apiKey?: string;
	apiKeyEnv?: string;
	baseURL?: string;
	label?: string;
	custom?: boolean;
	compatibility?: ProviderCompatibility;
	family?: ProviderPromptFamily;
	models?: ModelInfoMap;
	/** Ordered model IDs to prefer for lightweight/fast tasks like titles. */
	fastModels?: string[];
	allowAnyModel?: boolean;
	modelDiscovery?: {
		type: 'openai-models' | 'ollama';
	};
};

export type ProviderSettings = Record<string, ProviderSettingsEntry>;

export type SkillSettings = {
	enabled?: boolean;
	items?: Record<
		string,
		{
			enabled?: boolean;
		}
	>;
};

export type ReferenceSource =
	| {
			type: 'git';
			url: string;
			ref?: string;
	  }
	| {
			type: 'local';
			path: string;
	  };

export type ReferenceConfig = {
	description: string;
	enabled?: boolean;
	source: ReferenceSource;
};

export type ReferenceSettings = Record<string, ReferenceConfig>;

/**
 * Judge settings: a System One model (TypeSafe Jev) used for typed decisions
 * such as MCP tool safety classification and per-turn tool pre-activation.
 * Credentials live in the auth store under `typesafe` or `TYPESAFE_API_KEY`.
 */
export type JudgeSettings = {
	enabled?: boolean;
	provider?: 'typesafe';
	baseURL?: string;
	model?: string;
	timeoutMs?: number;
	mcp?: {
		classifyTools?: boolean;
		preloadTools?: boolean;
		preloadThreshold?: number;
	};
};

/** Global user-level memory preferences. The master switch disables all Otto memory use. */
export type MemorySettings = {
	enabled?: boolean;
	autoCapture?: boolean;
	recall?: boolean;
	recallInSubagents?: boolean;
	captureInSubagents?: boolean;
	embeddings?: {
		enabled?: boolean;
		backend?: 'local' | 'ollama' | 'provider' | 'none';
		provider?: 'openai' | 'google';
		model?: string;
		dims?: number;
	};
};

/**
 * Path configuration
 */
export type PathConfig = {
	projectConfigDir: string;
	projectConfigPath: string | null;
	projectStateDir: string;
	dataDir: string;
	dbPath: string;
	attachmentsDir: string;
	debugDir: string;
	debugDumpsDir: string;
	logsDir: string;
	tmpDir: string;
	cacheDir: string;
	globalConfigPath: string | null;
};

/**
 * Complete otto configuration object
 */
export type OttoConfig = {
	projectRoot: string;
	defaults: DefaultConfig;
	providers: ProviderSettings;
	skills?: SkillSettings;
	references?: ReferenceSettings;
	judge?: JudgeSettings;
	memory?: MemorySettings;
	paths: PathConfig;
	debugEnabled?: boolean;
	debugScopes?: string[];
	onboardingComplete?: boolean;
};
