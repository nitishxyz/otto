import type { AgentToolConfig } from '../agent/registry.ts';

export const FORGE_ACTIONS = [
	'docs',
	'capabilities',
	'inventory',
	'status',
	'search',
	'plan',
	'create',
	'install',
	'update',
	'remove',
	'enable',
	'disable',
	'validate',
	'authenticate',
	'reauthenticate',
	'logout',
	'execute',
] as const;

export const FORGE_KINDS = [
	'recipe',
	'skill',
	'agent',
	'mcp-server',
	'plugin',
	'plugin-command',
	'plugin-tool',
	'provider',
	'auth',
	'tunnel',
] as const;
export const FORGE_DOC_KINDS = [
	'recipe',
	'skill',
	'agent',
	'mcp-server',
	'plugin',
	'plugin-tool',
	'provider',
	'auth',
	'tunnel',
	'app',
] as const;
export const FORGE_INPUT_KINDS = [...FORGE_KINDS, 'app'] as const;
export const FORGE_SCOPES = ['project', 'global'] as const;
export const FORGE_MUTATIONS = ['create', 'update', 'remove'] as const;

export type ForgeAction = (typeof FORGE_ACTIONS)[number];
export type ForgeKind = (typeof FORGE_KINDS)[number];
export type ForgeDocKind = (typeof FORGE_DOC_KINDS)[number];
export type ForgeInputKind = (typeof FORGE_INPUT_KINDS)[number];
export type ForgeScope = (typeof FORGE_SCOPES)[number];
export type ForgeMutation = (typeof FORGE_MUTATIONS)[number];

export type ForgeInput = {
	action: ForgeAction;
	kind?: ForgeInputKind;
	topic?: string;
	query?: string;
	scope?: ForgeScope;
	name?: string;
	targetAction?: ForgeMutation;
	description?: string;
	label?: string;
	content?: string;
	source?: string;
	version?: string;
	displayName?: string;
	publisher?: string;
	homepage?: string;
	repository?: string;
	platforms?: Array<'darwin' | 'linux' | 'win32'>;
	tags?: string[];
	dependencies?: string[];
	requirements?: Array<{
		kind: 'platform' | 'command' | 'env' | 'toolchain';
		value: string;
		message?: string;
	}>;
	dryRun?: boolean;
	recipeAgent?: string;
	includeInHistory?: boolean;
	oneShot?: boolean;
	allowedTools?: string[];
	tools?: AgentToolConfig;
	appendTools?: AgentToolConfig;
	provider?: string;
	model?: string;
	compatibility?:
		| 'ollama'
		| 'openai-compatible'
		| 'openai'
		| 'anthropic'
		| 'google'
		| 'openrouter';
	family?:
		| 'default'
		| 'openai'
		| 'anthropic'
		| 'google'
		| 'kimi'
		| 'glm'
		| 'minimax';
	baseURL?: string;
	apiKeyEnv?: string;
	models?: string[];
	fastModels?: string[];
	allowAnyModel?: boolean;
	modelDiscovery?: 'openai-models' | 'ollama' | 'none';
	apiKey?: string;
	authMethod?: 'api-key' | 'oauth';
	oauthMode?: 'browser' | 'device';
	transport?: 'stdio' | 'http' | 'sse';
	command?: string;
	toolName?: string;
	entry?: string;
	inputSchema?: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	effects?: Array<
		| 'workspace-read'
		| 'workspace-write'
		| 'process'
		| 'network'
		| 'secrets'
		| 'external-write'
	>;
	secrets?: Array<{
		name: string;
		env: string;
		description?: string;
		required?: boolean;
	}>;
	timeoutMs?: number;
	toolInput?: Record<string, unknown>;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	parameters?: Record<
		string,
		{
			type: 'string' | 'number' | 'boolean' | 'enum';
			description?: string;
			required?: boolean;
			default?: string | number | boolean;
			values?: string[];
		}
	>;
	allowExtraArgs?: boolean;
	url?: string;
	headers?: Record<string, string>;
	start?: boolean;
	operation?: 'start' | 'stop' | 'restart';
	tunnelMode?: 'managed' | 'quick';
	tunnelScope?: 'remote-control' | 'project-share';
	projectId?: string;
	port?: number;
	plugin?: string;
	commandName?: string;
	commandArgs?: Record<string, string | number | boolean>;
	argsText?: string;
	extraArgs?: string[];
};

export type ForgeTarget = {
	kind: ForgeKind;
	scope: ForgeScope;
	name: string;
	paths: string[];
};

export type ForgePlan = {
	action:
		| ForgeMutation
		| 'install'
		| 'enable'
		| 'disable'
		| 'validate'
		| 'execute';
	target: ForgeTarget;
	exists: boolean;
	changes: string[];
	preview?: string;
};
