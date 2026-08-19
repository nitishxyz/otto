import { readdir } from 'node:fs/promises';
import {
	fileExists,
	getGlobalPluginsDir,
	getProjectPluginsDir,
	joinPath,
} from '../config/src/paths.ts';
import { getPluginsConfigPath, loadPluginsConfig } from './config.ts';
import { pluginManifestSchema, pluginNameSchema } from './schema.ts';
import type {
	DiscoveredPlugin,
	EffectivePlugin,
	EffectivePlugins,
	PluginsConfig,
	PluginsScopeState,
	PluginScope,
} from './schema.ts';

export async function discoverPlugins(
	projectRoot: string,
): Promise<{ global: PluginsScopeState; project: PluginsScopeState }> {
	const global = await discoverPluginScope('global');
	const project = await discoverPluginScope('project', projectRoot);
	return { global, project };
}

/** Resolve effective plugins after applying project precedence and disables. */
export async function resolveEffectivePlugins(
	projectRoot: string,
): Promise<EffectivePlugins> {
	const discovered = await discoverPlugins(projectRoot);
	const effective = new Map<string, EffectivePlugin>();

	for (const plugin of discovered.global.plugins) {
		effective.set(plugin.name, { ...plugin });
	}

	for (const projectPlugin of discovered.project.plugins) {
		const globalPlugin = effective.get(projectPlugin.name);
		if (
			projectPlugin.configEntry?.enabled === false &&
			!projectPlugin.installed &&
			globalPlugin
		) {
			effective.set(projectPlugin.name, {
				...globalPlugin,
				scope: 'project',
				configEntry: projectPlugin.configEntry,
				enabled: false,
				overriddenByProject: true,
			});
			continue;
		}

		effective.set(projectPlugin.name, {
			...projectPlugin,
			overriddenByProject: Boolean(globalPlugin),
		});
	}

	return {
		...discovered,
		plugins: Array.from(effective.values()).sort((a, b) =>
			a.name.localeCompare(b.name),
		),
	};
}

async function discoverPluginScope(
	scope: PluginScope,
	projectRoot?: string,
): Promise<PluginsScopeState> {
	const configPath = getPluginsConfigPath(scope, projectRoot);
	const pluginsDir = getPluginsDir(scope, projectRoot);
	const config = await loadPluginsConfig(scope, projectRoot);
	const names = new Set<string>(Object.keys(config.plugins));

	for (const dirName of await readPluginDirNames(pluginsDir)) {
		names.add(dirName);
	}

	const plugins: DiscoveredPlugin[] = [];
	for (const name of Array.from(names).sort()) {
		plugins.push(await readDiscoveredPlugin(scope, pluginsDir, name, config));
	}

	return { scope, configPath, pluginsDir, config, plugins };
}

async function readPluginDirNames(pluginsDir: string): Promise<string[]> {
	try {
		const entries = await readdir(pluginsDir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.filter((name) => pluginNameSchema.safeParse(name).success);
	} catch {
		return [];
	}
}

export async function readDiscoveredPlugin(
	scope: PluginScope,
	pluginsDir: string,
	name: string,
	config: PluginsConfig,
): Promise<DiscoveredPlugin> {
	const dir = joinPath(pluginsDir, name);
	const manifestPath = joinPath(dir, 'otto.plugin.json');
	const configEntry = config.plugins[name];
	const enabled = configEntry?.enabled ?? true;

	if (!(await fileExists(manifestPath))) {
		return {
			name,
			scope,
			dir,
			manifestPath,
			configEntry,
			enabled,
			installed: false,
			status: 'missing',
			error: 'Missing otto.plugin.json',
		};
	}

	try {
		const parsed = JSON.parse(await Bun.file(manifestPath).text());
		const manifest = pluginManifestSchema.parse(parsed);
		return {
			name,
			scope,
			dir,
			manifestPath,
			configEntry,
			enabled,
			installed: true,
			status: 'installed',
			manifest,
		};
	} catch (error) {
		return {
			name,
			scope,
			dir,
			manifestPath,
			configEntry,
			enabled,
			installed: false,
			status: 'invalid',
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function getPluginsDir(
	scope: PluginScope,
	projectRoot?: string,
): string {
	if (scope === 'global') return getGlobalPluginsDir();
	if (!projectRoot)
		throw new Error('projectRoot is required for project plugins');
	return getProjectPluginsDir(projectRoot);
}
