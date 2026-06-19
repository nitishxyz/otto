import {
	BUILTIN_AGENT_DESCRIPTIONS,
	normalizeAgentDescription,
} from './descriptions.ts';
import { loadAgentsConfig } from './config.ts';
import { discoverAllAgents } from './discovery.ts';
import { normalizeModel, normalizeProvider } from './normalize.ts';
import {
	defaultToolConfigForAgent,
	mergeToolGroups,
	normalizeAgentToolConfig,
	normalizeRequiredToolGroups,
} from './tools.ts';
import type {
	AgentConfig,
	AgentToolConfig,
	AgentToolGroups,
	AgentsJson,
} from './types.ts';
import { resolveAgentPrompt } from '../registry-prompts.ts';

export async function resolveAgentConfig(
	projectRoot: string,
	name: string,
	inlineConfig?: {
		prompt?: string;
		tools?: AgentToolConfig;
		provider?: string;
		model?: string;
	},
): Promise<AgentConfig> {
	if (inlineConfig?.prompt) {
		const provider = normalizeProvider(inlineConfig.provider);
		const model = normalizeModel(inlineConfig.model);
		const toolConfig = normalizeRequiredToolGroups(
			normalizeAgentToolConfig(inlineConfig.tools) ??
				defaultToolConfigForAgent(name),
		);
		return {
			name,
			prompt: inlineConfig.prompt,
			toolConfig,
			provider,
			model,
		};
	}
	const agents = await loadAgentsConfig(projectRoot);
	const entry = agents[name];
	const { prompt } = await resolveAgentPrompt({
		projectRoot,
		name,
		entryPrompt: entry?.prompt,
	});

	let toolConfig: AgentToolGroups | undefined = entry?.tools
		? normalizeAgentToolConfig(entry.tools)
		: defaultToolConfigForAgent(name);
	if (!entry || !entry.tools) {
		toolConfig = defaultToolConfigForAgent(name);
	}
	const appendTools = normalizeAgentToolConfig(entry?.appendTools);
	if (appendTools) {
		toolConfig = mergeToolGroups(toolConfig, appendTools) ?? toolConfig;
	}
	const normalizedToolConfig = normalizeRequiredToolGroups(toolConfig ?? {});
	const provider = normalizeProvider(entry?.provider);
	const model = normalizeModel(entry?.model);
	const description =
		normalizeAgentDescription(entry?.description) ??
		BUILTIN_AGENT_DESCRIPTIONS[name];
	return {
		name,
		prompt,
		toolConfig: normalizedToolConfig,
		provider,
		model,
		description,
	};
}

/**
 * Lists all known agents with their one-line descriptions. Used to tell agents
 * which specialists they can delegate to.
 */
export async function listAgentDescriptions(
	projectRoot: string,
): Promise<Array<{ name: string; description?: string }>> {
	const [names, agentsJson] = await Promise.all([
		discoverAllAgents(projectRoot),
		loadAgentsConfig(projectRoot).catch(() => ({}) as AgentsJson),
	]);
	return names.map((name) => ({
		name,
		description:
			normalizeAgentDescription(agentsJson[name]?.description) ??
			BUILTIN_AGENT_DESCRIPTIONS[name],
	}));
}
