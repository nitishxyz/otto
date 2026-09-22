import { createJudge, type JudgeSettings } from '../../../judge/index.ts';
import { resolveJudgeConfig } from '../../../judge/config.ts';
import { logger } from '../utils/logger.ts';
import {
	classifyMCPTools,
	mcpToolClassificationKey,
	type MCPToolClassification,
} from './classify.ts';
import type { MCPServerManager } from './server-manager.ts';

type RegistryEntry = {
	signature: string;
	classifications: Map<string, MCPToolClassification>;
	inFlight?: Promise<Map<string, MCPToolClassification>>;
};

const registry = new Map<string, RegistryEntry>();

function registryKey(projectRoot?: string): string {
	return projectRoot ?? '';
}

function signatureFor(manager: MCPServerManager): string {
	return manager
		.getTools()
		.map((entry) => mcpToolClassificationKey(entry))
		.sort()
		.join('\n');
}

/** Last resolved classifications for a project, without triggering work. */
export function getCachedMCPToolClassifications(
	projectRoot?: string,
): ReadonlyMap<string, MCPToolClassification> {
	return (
		registry.get(registryKey(projectRoot))?.classifications ??
		new Map<string, MCPToolClassification>()
	);
}

export function clearMCPToolClassifications(projectRoot?: string): void {
	if (projectRoot === undefined) registry.clear();
	else registry.delete(registryKey(projectRoot));
}

/**
 * Resolve classifications for the manager's current tool set. Memoized on the
 * tool-set signature; re-runs only when tools are added or their contracts
 * change. Never throws: on any failure the previous map (or empty) is returned.
 */
export async function resolveMCPToolClassifications(
	manager: MCPServerManager,
	options: { projectRoot?: string; settings?: JudgeSettings } = {},
): Promise<ReadonlyMap<string, MCPToolClassification>> {
	const key = registryKey(options.projectRoot);
	const signature = signatureFor(manager);
	const existing = registry.get(key);
	if (existing?.signature === signature) {
		return existing.inFlight ?? existing.classifications;
	}

	const entry: RegistryEntry = {
		signature,
		classifications: existing?.classifications ?? new Map(),
	};
	registry.set(key, entry);

	entry.inFlight = (async () => {
		try {
			const config = await resolveJudgeConfig(
				options.settings,
				options.projectRoot,
			);
			const judge = config.mcp.classifyTools
				? await createJudge({
						settings: options.settings,
						projectRoot: options.projectRoot,
					})
				: null;
			const result = await classifyMCPTools(manager.getTools(), { judge });
			entry.classifications = result;
			if (result.size > 0) {
				logger.debug('[mcp] classified tools', {
					total: manager.getTools().length,
					classified: result.size,
					judge: Boolean(judge),
				});
			}
			return result;
		} catch (error) {
			logger.debug('[mcp] tool classification failed', {
				error: error instanceof Error ? error.message : String(error),
			});
			return entry.classifications;
		} finally {
			entry.inFlight = undefined;
		}
	})();
	return entry.inFlight;
}
