import { getGlobalAgentsJsonPath } from '@ottocode/sdk';
import { mergeAgentEntries } from './normalize.ts';
import type { AgentsJson } from './types.ts';

export async function loadAgentsConfig(
	projectRoot: string,
): Promise<AgentsJson> {
	const localPath = `${projectRoot}/.otto/agents.json`.replace(/\\/g, '/');
	const globalPath = getGlobalAgentsJsonPath();
	let globalCfg: AgentsJson = {};
	let localCfg: AgentsJson = {};
	try {
		const gf = Bun.file(globalPath);
		if (await gf.exists()) {
			globalCfg = (await gf.json().catch(() => ({}))) as AgentsJson;
		}
	} catch {}
	try {
		const lf = Bun.file(localPath);
		if (await lf.exists()) {
			localCfg = (await lf.json().catch(() => ({}))) as AgentsJson;
		}
	} catch {}
	const merged: AgentsJson = {};
	for (const [name, entry] of Object.entries(globalCfg)) {
		merged[name] = mergeAgentEntries(undefined, entry ?? {});
	}
	for (const [name, entry] of Object.entries(localCfg)) {
		const base = merged[name];
		merged[name] = mergeAgentEntries(base, entry ?? {});
	}
	return merged;
}
