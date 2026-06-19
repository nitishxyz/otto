import { getGlobalAgentsJsonPath } from '@ottocode/sdk';
import { loadAgentsConfig } from '../registry.ts';
import { localAgentsJsonPath, readAgentsJson } from './paths.ts';
import type { AgentConfigLayers } from './types.ts';

export async function loadAgentConfigLayers(
	projectRoot: string,
): Promise<AgentConfigLayers> {
	const [globalCfg, localCfg, merged] = await Promise.all([
		readAgentsJson(getGlobalAgentsJsonPath()),
		readAgentsJson(localAgentsJsonPath(projectRoot)),
		loadAgentsConfig(projectRoot),
	]);
	return { global: globalCfg, local: localCfg, merged };
}
