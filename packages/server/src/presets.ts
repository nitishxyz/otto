import AGENT_BUILD from '@ottocode/sdk/prompts/agents/build.txt' with {
	type: 'text',
};
import AGENT_PLAN from '@ottocode/sdk/prompts/agents/plan.txt' with {
	type: 'text',
};
import AGENT_GENERAL from '@ottocode/sdk/prompts/agents/general.txt' with {
	type: 'text',
};
import AGENT_INIT from '@ottocode/sdk/prompts/agents/init.txt' with {
	type: 'text',
};
import AGENT_RESEARCH from '@ottocode/sdk/prompts/agents/research.txt' with {
	type: 'text',
};
import {
	defaultToolConfigForAgent,
	type AgentToolGroups,
} from './runtime/agent/registry.ts';

type BuiltinAgentPreset = {
	prompt: string;
	tools: Required<AgentToolGroups>;
};

/**
 * Built-in agent presets exported for embedding.
 *
 * These are derived from the same runtime defaults used by the server so
 * embedding docs and runtime behavior stay in sync.
 */
export const BUILTIN_AGENTS = {
	build: {
		prompt: AGENT_BUILD,
		tools: defaultToolConfigForAgent('build'),
	},
	plan: {
		prompt: AGENT_PLAN,
		tools: defaultToolConfigForAgent('plan'),
	},
	general: {
		prompt: AGENT_GENERAL,
		tools: defaultToolConfigForAgent('general'),
	},
	init: {
		prompt: AGENT_INIT,
		tools: defaultToolConfigForAgent('init'),
	},
	research: {
		prompt: AGENT_RESEARCH,
		tools: defaultToolConfigForAgent('research'),
	},
} satisfies Record<string, BuiltinAgentPreset>;

/**
 * Built-in tool names available from the server runtime.
 *
 * This includes the standard runtime tools plus the research-oriented
 * database tools that are available to the research preset.
 *
 * This is the global built-in tool universe, not the tool list for every
 * agent. Agent-specific access should come from BUILTIN_AGENTS[agent].tools
 * or project/global overrides.
 */
export const BUILTIN_TOOLS = [
	'read',
	'edit',
	'multiedit',
	'write',
	'copy_into',
	'ls',
	'tree',
	'pwd',
	'cd',
	'shell',
	'terminal',
	'search',
	'glob',
	'git_status',
	'git_diff',
	'git_commit',
	'apply_patch',
	'update_todos',
	'websearch',
	'progress_update',
	'skill',
	'query_sessions',
	'query_messages',
	'get_session_context',
	'search_history',
	'get_parent_session',
	'present_action',
] as const;

export type BuiltinAgent = keyof typeof BUILTIN_AGENTS;
export type BuiltinTool = (typeof BUILTIN_TOOLS)[number];
