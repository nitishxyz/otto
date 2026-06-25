import { getGlobalAgentsDir, loadConfig } from '@ottocode/sdk';
import {
	BUILTIN_AGENT_DESCRIPTIONS,
	BUILTIN_AGENT_NAMES,
	defaultToolConfigForAgent,
	discoverAllAgents,
	resolveAgentConfig,
} from '../registry.ts';
import { resolveAgentPrompt } from '../registry-prompts.ts';
import { loadAgentConfigLayers } from './layers.ts';
import {
	isGlobalPromptSource,
	isLocalPromptSource,
	normalizePath,
} from './paths.ts';
import type { AgentDetail, AgentDetailSource } from './types.ts';
import { getPluginProvidedAgentNames } from '../registry/plugins.ts';
import { normalizeToolGroups, validateAgentName } from './validation.ts';

function isBuiltinAgent(name: string): boolean {
	return BUILTIN_AGENT_NAMES.includes(name);
}

function getAgentSource(args: {
	name: string;
	hasLocalEntry: boolean;
	hasGlobalEntry: boolean;
	hasLocalPrompt: boolean;
	hasGlobalPrompt: boolean;
	hasPluginEntry: boolean;
	promptSource: string;
}): AgentDetailSource {
	const hasLocal = args.hasLocalEntry || args.hasLocalPrompt;
	const hasGlobal = args.hasGlobalEntry || args.hasGlobalPrompt;
	if (hasLocal && hasGlobal) return 'merged';
	if (hasLocal) return 'local';
	if (hasGlobal) return 'global';
	if (args.hasPluginEntry) return 'plugin';
	if (args.promptSource.startsWith('fallback:embedded:')) return 'embedded';
	if (isBuiltinAgent(args.name)) return 'builtin';
	return 'embedded';
}

export async function getAgentDetail(
	projectRoot: string,
	nameInput: string,
): Promise<AgentDetail> {
	const name = validateAgentName(nameInput);
	const layers = await loadAgentConfigLayers(projectRoot);
	const entry = layers.merged[name];
	const agentCfg = await resolveAgentConfig(projectRoot, name);
	const promptResolution = await resolveAgentPrompt({
		projectRoot,
		name,
		entryPrompt: entry?.prompt,
	});
	const hasLocalEntry = Object.hasOwn(layers.local, name);
	const hasGlobalEntry = Object.hasOwn(layers.global, name);
	const hasLocalPrompt = isLocalPromptSource(
		projectRoot,
		promptResolution.source,
	);
	const hasGlobalPrompt = isGlobalPromptSource(promptResolution.source);
	const pluginProvidedNames = await getPluginProvidedAgentNames(projectRoot);
	const hasPluginEntry =
		pluginProvidedNames.has(name) && !hasLocalEntry && !hasGlobalEntry;
	const builtin = isBuiltinAgent(name);

	return {
		name,
		builtin,
		custom: !builtin,
		source: getAgentSource({
			name,
			hasLocalEntry,
			hasGlobalEntry,
			hasLocalPrompt,
			hasGlobalPrompt,
			hasPluginEntry,
			promptSource: promptResolution.source,
		}),
		prompt: promptResolution.prompt,
		promptSource: promptResolution.source,
		description: agentCfg.description,
		defaultDescription: BUILTIN_AGENT_DESCRIPTIONS[name],
		toolConfig: agentCfg.toolConfig,
		defaultToolConfig: defaultToolConfigForAgent(name),
		appendToolConfig: normalizeToolGroups(entry?.appendTools) ?? {},
		provider: agentCfg.provider,
		model: agentCfg.model,
		editable: true,
		hasLocalOverride: hasLocalEntry || hasLocalPrompt,
		hasGlobalOverride: hasGlobalEntry || hasGlobalPrompt,
	};
}

export async function getAllAgentDetails(projectRoot: string): Promise<{
	agents: AgentDetail[];
	default: string;
}> {
	const cfg = await loadConfig(projectRoot);
	const names = await discoverAllAgents(cfg.projectRoot);
	const agents = await Promise.all(
		names.map((name) => getAgentDetail(cfg.projectRoot, name)),
	);
	return {
		agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
		default: cfg.defaults.agent,
	};
}

export function isBuiltinAgentName(name: string): boolean {
	return isBuiltinAgent(name);
}

export function isGlobalAgentPromptPath(source: string): boolean {
	return normalizePath(source).includes(normalizePath(getGlobalAgentsDir()));
}
