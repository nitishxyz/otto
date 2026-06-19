export {
	BUILTIN_AGENT_DESCRIPTIONS,
	BUILTIN_AGENT_NAMES,
	HIDDEN_BUILTIN_AGENT_NAMES,
	MAX_AGENT_DESCRIPTION_LENGTH,
	isHiddenAgent,
	normalizeAgentDescription,
} from './registry/descriptions.ts';
export { loadAgentsConfig } from './registry/config.ts';
export { discoverAllAgents } from './registry/discovery.ts';
export {
	mergeAgentEntries,
	normalizeModel,
	normalizeProvider,
} from './registry/normalize.ts';
export {
	defaultToolConfigForAgent,
	flattenAgentToolConfig,
	mergeToolGroups,
	normalizeAgentToolConfig,
	normalizeRequiredToolGroups,
} from './registry/tools.ts';
export {
	listAgentDescriptions,
	resolveAgentConfig,
} from './registry/resolve.ts';
export type {
	AgentConfig,
	AgentConfigEntry,
	AgentToolConfig,
	AgentToolGroups,
	AgentsJson,
} from './registry/types.ts';
