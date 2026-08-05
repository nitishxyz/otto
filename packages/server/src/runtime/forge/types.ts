import type { AgentToolConfig } from '../agent/registry.ts';

export const FORGE_ACTIONS = [
	'docs',
	'capabilities',
	'inventory',
	'status',
	'plan',
	'create',
	'update',
	'remove',
	'enable',
	'disable',
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
	'plugin-command',
	'provider',
	'auth',
	'tunnel',
] as const;
export const FORGE_DOC_KINDS = [
	'recipe',
	'skill',
	'agent',
	'mcp-server',
	'provider',
	'auth',
	'tunnel',
	'plugin',
	'app',
] as const;
export const FORGE_INPUT_KINDS = [...FORGE_KINDS, 'plugin', 'app'] as const;
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
	args?: string[];
	env?: Record<string, string>;
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
	action: ForgeMutation;
	target: ForgeTarget;
	exists: boolean;
	changes: string[];
	preview?: string;
};
