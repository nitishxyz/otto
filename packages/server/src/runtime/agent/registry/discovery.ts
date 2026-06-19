import { getGlobalAgentsDir } from '@ottocode/sdk';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILTIN_AGENT_NAMES, isHiddenAgent } from './descriptions.ts';
import { loadAgentsConfig } from './config.ts';

export async function discoverAllAgents(
	projectRoot: string,
): Promise<string[]> {
	const agentSet = new Set<string>(BUILTIN_AGENT_NAMES);

	try {
		const agentsJson = await loadAgentsConfig(projectRoot);
		for (const agentName of Object.keys(agentsJson)) {
			if (agentName.trim()) {
				agentSet.add(agentName);
			}
		}
	} catch {}

	try {
		const localAgentsPath = join(projectRoot, '.otto', 'agents');
		const localFiles = await readdir(localAgentsPath).catch(() => []);
		for (const file of localFiles) {
			if (file.endsWith('.txt') || file.endsWith('.md')) {
				const agentName = file.replace(/\.(txt|md)$/, '');
				if (agentName.trim()) {
					agentSet.add(agentName);
				}
			}
		}
	} catch {}

	try {
		const globalAgentsPath = getGlobalAgentsDir();
		const globalFiles = await readdir(globalAgentsPath).catch(() => []);
		for (const file of globalFiles) {
			if (file.endsWith('.txt') || file.endsWith('.md')) {
				const agentName = file.replace(/\.(txt|md)$/, '');
				if (agentName.trim()) {
					agentSet.add(agentName);
				}
			}
		}
	} catch {}

	return Array.from(agentSet)
		.filter((name) => !isHiddenAgent(name))
		.sort();
}
