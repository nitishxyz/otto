import type { AgentToolConfig } from '../agent/registry.ts';

export const FORGE_ACTIONS = [
	'inventory',
	'plan',
	'create',
	'update',
	'remove',
	'enable',
	'disable',
	'execute',
] as const;

export const FORGE_KINDS = [
	'recipe',
	'skill',
	'agent',
	'mcp-server',
	'plugin-command',
] as const;
export const FORGE_SCOPES = ['project', 'global'] as const;
export const FORGE_MUTATIONS = ['create', 'update', 'remove'] as const;

export type ForgeAction = (typeof FORGE_ACTIONS)[number];
export type ForgeKind = (typeof FORGE_KINDS)[number];
export type ForgeScope = (typeof FORGE_SCOPES)[number];
export type ForgeMutation = (typeof FORGE_MUTATIONS)[number];

export type ForgeInput = {
	action: ForgeAction;
	kind?: ForgeKind;
	scope?: ForgeScope;
	name?: string;
	targetAction?: ForgeMutation;
	description?: string;
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
	transport?: 'stdio' | 'http' | 'sse';
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	start?: boolean;
	operation?: 'start' | 'stop' | 'restart';
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
