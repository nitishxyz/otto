import type {
	AgentToolConfig,
	AgentToolGroups,
	AgentsJson,
} from '../registry.ts';

export type AgentConfigScope = 'local' | 'global';

export type AgentDetailSource =
	| 'builtin'
	| 'local'
	| 'global'
	| 'merged'
	| 'embedded';

export type AgentDetail = {
	name: string;
	builtin: boolean;
	custom: boolean;
	source: AgentDetailSource;
	prompt: string;
	promptSource: string;
	description?: string;
	defaultDescription?: string;
	toolConfig: Required<AgentToolGroups>;
	defaultToolConfig: Required<AgentToolGroups>;
	appendToolConfig: AgentToolGroups;
	provider?: string;
	model?: string;
	editable: boolean;
	hasLocalOverride: boolean;
	hasGlobalOverride: boolean;
};

export type UpsertAgentInput = {
	scope?: AgentConfigScope;
	prompt?: string;
	promptStorage?: 'file' | 'inline';
	description?: string | null;
	tools?: AgentToolConfig;
	appendTools?: AgentToolConfig;
	provider?: string | null;
	model?: string | null;
};

export type AgentConfigLayers = {
	global: AgentsJson;
	local: AgentsJson;
	merged: AgentsJson;
};
