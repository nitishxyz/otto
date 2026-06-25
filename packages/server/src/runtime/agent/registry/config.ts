import { getGlobalAgentsJsonPath } from '@ottocode/sdk';
import { mergeAgentEntries } from './normalize.ts';
import { loadPluginAgentsForScope } from './plugins.ts';
import type { AgentsJson } from './types.ts';

async function readAgentsJsonFile(path: string): Promise<AgentsJson> {
	try {
		const file = Bun.file(path);
		if (!(await file.exists())) return {};
		return ((await file.json().catch(() => ({}))) as AgentsJson) ?? {};
	} catch {
		return {};
	}
}

export async function loadAgentsConfig(
	projectRoot: string,
): Promise<AgentsJson> {
	const localPath = `${projectRoot}/.otto/agents.json`.replace(/\\/g, '/');
	const globalPath = getGlobalAgentsJsonPath();
	const [globalPluginCfg, globalCfg, projectPluginCfg, localCfg] =
		await Promise.all([
			loadPluginAgentsForScope(projectRoot, 'global'),
			readAgentsJsonFile(globalPath),
			loadPluginAgentsForScope(projectRoot, 'project'),
			readAgentsJsonFile(localPath),
		]);

	const merged: AgentsJson = {};
	for (const [name, entry] of Object.entries(globalPluginCfg)) {
		merged[name] = mergeAgentEntries(undefined, entry ?? {});
	}
	for (const [name, entry] of Object.entries(globalCfg)) {
		merged[name] = mergeAgentEntries(merged[name], entry ?? {});
	}
	for (const [name, entry] of Object.entries(projectPluginCfg)) {
		merged[name] = mergeAgentEntries(merged[name], entry ?? {});
	}
	for (const [name, entry] of Object.entries(localCfg)) {
		merged[name] = mergeAgentEntries(merged[name], entry ?? {});
	}
	return merged;
}
