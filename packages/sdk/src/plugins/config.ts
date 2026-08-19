import {
	ensureDir,
	getGlobalPluginsConfigPath,
	getProjectPluginsConfigPath,
} from '../config/src/paths.ts';
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
	await ensureDir(configPath.slice(0, configPath.lastIndexOf('/')));
	const normalized = pluginsConfigSchema.parse(config);
	await Bun.write(configPath, `${JSON.stringify(normalized, null, 2)}\n`);
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
