import { resolveEffectivePlugins } from '@ottocode/sdk';
import { resolve } from 'node:path';
import { mergeAgentEntries } from './normalize.ts';
import type { AgentConfigEntry, AgentsJson } from './types.ts';

const PLUGIN_AGENT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isPathInsidePluginDir(
	pluginDir: string,
	candidatePath: string,
): boolean {
	const resolvedPluginDir = resolve(pluginDir);
	const resolvedPath = resolve(candidatePath);
	return (
		resolvedPath === resolvedPluginDir ||
		resolvedPath.startsWith(`${resolvedPluginDir}/`)
	);
}

function pluginAgentToEntry(
	pluginDir: string,
	agent: {
		name: string;
		path?: string;
		prompt?: string;
		description?: string;
		provider?: string;
		model?: string;
		tools?: AgentConfigEntry['tools'];
		appendTools?: AgentConfigEntry['appendTools'];
	},
): AgentConfigEntry | null {
	if (!PLUGIN_AGENT_NAME_PATTERN.test(agent.name)) return null;

	let prompt: string | undefined;
	if (agent.prompt?.trim()) {
		prompt = agent.prompt.trim();
	} else if (agent.path) {
		const resolvedPath = resolve(pluginDir, agent.path);
		if (!isPathInsidePluginDir(pluginDir, resolvedPath)) return null;
		prompt = resolvedPath;
	} else {
		return null;
	}

	const entry: AgentConfigEntry = { prompt };
	if (agent.description) entry.description = agent.description;
	if (agent.provider) entry.provider = agent.provider;
	if (agent.model) entry.model = agent.model;
	if (agent.tools) entry.tools = agent.tools;
	if (agent.appendTools) entry.appendTools = agent.appendTools;
	return entry;
}

export async function loadPluginAgentsForScope(
	projectRoot: string,
	scope: 'global' | 'project',
): Promise<AgentsJson> {
	let effectivePlugins: Awaited<ReturnType<typeof resolveEffectivePlugins>>;
	try {
		effectivePlugins = await resolveEffectivePlugins(projectRoot);
	} catch {
		return {};
	}

	const agents: AgentsJson = {};
	const plugins = effectivePlugins.plugins
		.filter(
			(plugin) =>
				plugin.scope === scope &&
				plugin.enabled &&
				plugin.status === 'installed' &&
				plugin.manifest?.agents?.length,
		)
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const plugin of plugins) {
		for (const pluginAgent of plugin.manifest?.agents ?? []) {
			const entry = pluginAgentToEntry(plugin.dir, pluginAgent);
			if (!entry) continue;
			agents[pluginAgent.name] = mergeAgentEntries(
				agents[pluginAgent.name],
				entry,
			);
		}
	}

	return agents;
}

/** Merged plugin agent entries with project scope overriding global for duplicate names. */
export async function loadPluginAgentsConfig(
	projectRoot: string,
): Promise<AgentsJson> {
	const [globalAgents, projectAgents] = await Promise.all([
		loadPluginAgentsForScope(projectRoot, 'global'),
		loadPluginAgentsForScope(projectRoot, 'project'),
	]);

	const merged: AgentsJson = {};
	for (const [name, entry] of Object.entries(globalAgents)) {
		merged[name] = mergeAgentEntries(undefined, entry);
	}
	for (const [name, entry] of Object.entries(projectAgents)) {
		merged[name] = mergeAgentEntries(merged[name], entry);
	}
	return merged;
}

/** Agent names contributed only by enabled installed plugins (before file overrides). */
export async function getPluginProvidedAgentNames(
	projectRoot: string,
): Promise<Set<string>> {
	const pluginAgents = await loadPluginAgentsConfig(projectRoot);
	return new Set(Object.keys(pluginAgents));
}
