// Barrel export for backwards compatibility with @ottocode/server/runtime/agent-registry
export {
	discoverAllAgents,
	resolveAgentConfig,
	defaultToolConfigForAgent,
	flattenAgentToolConfig,
	BUILTIN_AGENT_NAMES,
	type AgentToolConfig,
	type AgentToolGroups,
	type AgentConfigEntry,
	type AgentsJson,
} from './agent/registry.ts';
export {
	getAgentDetail,
	getAllAgentDetails,
	upsertAgentConfig,
	deleteAgentConfig,
	validateAgentName,
	type AgentDetail,
	type AgentConfigScope,
} from './agent/config-management.ts';
