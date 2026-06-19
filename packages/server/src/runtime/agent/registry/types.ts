import type { ProviderName } from '@ottocode/sdk';

export type AgentConfig = {
	name: string;
	prompt: string;
	toolConfig: Required<AgentToolGroups>;
	provider?: ProviderName;
	model?: string;
	description?: string;
};

export type AgentToolGroups = {
	firstClass?: string[];
	loadable?: string[];
};

export type AgentToolConfig = AgentToolGroups;

export type AgentConfigEntry = {
	tools?: AgentToolConfig;
	appendTools?: AgentToolConfig;
	prompt?: string;
	provider?: string;
	model?: string;
	description?: string;
};

export type AgentsJson = Record<string, AgentConfigEntry>;
