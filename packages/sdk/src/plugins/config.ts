import {
	getGlobalPluginsConfigPath,
	getProjectPluginsConfigPath,
} from '../config/src/paths.ts';
import { atomicWriteText, serializeByKey } from './fs-safety.ts';
import { pluginsConfigSchema } from './schema.ts';
import type { PluginsConfig, PluginScope } from './schema.ts';

export async function loadPluginsConfig(
	scope: PluginScope,
	projectRoot?: string,
): Promise<PluginsConfig> {
	const configPath = getPluginsConfigPath(scope, projectRoot);
	const file = Bun.file(configPath);
	if (!(await file.exists())) return pluginsConfigSchema.parse({});
	const parsed = JSON.parse(await file.text());
	return pluginsConfigSchema.parse(parsed);
}

/** Write the plugins.json control plane for a global or project scope. */
export async function writePluginsConfig(
	scope: PluginScope,
	config: PluginsConfig,
	projectRoot?: string,
): Promise<void> {
	const configPath = getPluginsConfigPath(scope, projectRoot);
	const normalized = pluginsConfigSchema.parse(config);
	await serializeByKey(configPath, () =>
		atomicWriteText(configPath, `${JSON.stringify(normalized, null, 2)}\n`),
	);
}

/**
 * Serialized read-modify-write of a scope's plugins.json. Concurrent callers on
 * the same file never lose each other's updates.
 */
export async function updatePluginsConfig(
	scope: PluginScope,
	projectRoot: string | undefined,
	mutate: (config: PluginsConfig) => void | Promise<void>,
): Promise<PluginsConfig> {
	const configPath = getPluginsConfigPath(scope, projectRoot);
	return serializeByKey(configPath, async () => {
		const config = await loadPluginsConfig(scope, projectRoot);
		await mutate(config);
		const normalized = pluginsConfigSchema.parse(config);
		await atomicWriteText(
			configPath,
			`${JSON.stringify(normalized, null, 2)}\n`,
		);
		return normalized;
	});
}

export function getPluginsConfigPath(
	scope: PluginScope,
	projectRoot?: string,
): string {
	if (scope === 'global') return getGlobalPluginsConfigPath();
	if (!projectRoot)
		throw new Error('projectRoot is required for project plugins');
	return getProjectPluginsConfigPath(projectRoot);
}

/** Discover configured and directory-installed plugin payloads. */
