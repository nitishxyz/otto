import type {
	ModelInfo,
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

export type DefaultConfig = {
	agent: string;
	provider: ProviderId;
	model: string;
	toolApproval?: ToolApprovalMode;
	guidedMode?: boolean;
	reasoningText?: boolean;
	reasoningLevel?: ReasoningLevel;
	theme?: string;
	vimMode?: boolean;
	compactThread?: boolean;
	fontFamily?: string;
	smartEdges?: boolean;
	releaseToSend?: boolean;
	fullWidthContent?: boolean;
	autoCompactThresholdTokens?: number | null;
	/** Adds the ottocode bot as a co-author on commits made through Otto. */
	coAuthorCommits?: boolean;
	/** Enables the otto supervisor agent and persistent goals (disabled together). */
	ottoEnabled?: boolean;
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
	models?: Array<string | ModelInfo>;
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
	paths: PathConfig;
	debugEnabled?: boolean;
	debugScopes?: string[];
	onboardingComplete?: boolean;
};
