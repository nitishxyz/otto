import { rm } from 'node:fs/promises';
import { joinPath } from '../config/src/paths.ts';
import { loadPluginsConfig, writePluginsConfig } from './config.ts';
import { getPluginsDir, readDiscoveredPlugin } from './discovery.ts';
import { resolveRegistryPlugin } from './registry.ts';
import type {
	DiscoveredPlugin,
	PluginInstallOptions,
	PluginManifest,
	PluginsConfig,
	PluginScope,
} from './schema.ts';
import {
	installRegistryEntryPayload,
	isLocalSource,
	materializePluginSkillSources,
	normalizeLocalSource,
	copyPluginDir,
	readPluginManifestFromDir,
} from './source.ts';
import {
	removeSyncedPluginSkills,
	syncPluginSkillsToAgentsDir,
} from './skills.ts';

export async function installPlugin(
	source: string,
	options: PluginInstallOptions = {},
): Promise<DiscoveredPlugin> {
	return installPluginWithContext(source, options, { visited: new Set() });
}

type PluginInstallContext = {
	visited: Set<string>;
	installedBy?: string;
};

async function installPluginWithContext(
	source: string,
	options: PluginInstallOptions,
	context: PluginInstallContext,
): Promise<DiscoveredPlugin> {
	const scope = options.scope ?? (isLocalSource(source) ? 'project' : 'global');
	const pluginsDir = getPluginsDir(scope, options.projectRoot);
	let manifest: PluginManifest;
	let sourceLabel: string;

	if (isLocalSource(source)) {
		const sourceDir = normalizeLocalSource(source);
		manifest = await readPluginManifestFromDir(sourceDir);
		const targetDir = joinPath(pluginsDir, manifest.name);
		await copyPluginDir(sourceDir, targetDir);
		manifest = await materializePluginSkillSources(
			targetDir,
			manifest,
			options.fetch,
		);
		sourceLabel = `local:${sourceDir}`;
	} else {
		const { registryUrl, entry } = await resolveRegistryPlugin(source, options);
		const targetDir = joinPath(pluginsDir, entry.name);
		await installRegistryEntryPayload(
			entry,
			targetDir,
			options.fetch,
			registryUrl,
		);
		manifest = await readPluginManifestFromDir(targetDir);
		manifest = await materializePluginSkillSources(
			targetDir,
			manifest,
			options.fetch,
		);
		sourceLabel = entry.official
			? `official:${entry.name}`
			: `registry:${entry.name}`;
	}

	context.visited.add(manifest.name);

	const now = new Date().toISOString();
	const config = await loadPluginsConfig(scope, options.projectRoot);
	const previousEntry = config.plugins[manifest.name];
	const installedBy = new Set(previousEntry?.installedBy ?? []);
	if (context.installedBy) installedBy.add(context.installedBy);
	config.plugins[manifest.name] = {
		enabled: options.enabled ?? true,
		source: sourceLabel,
		version: manifest.version,
		installedAt: previousEntry?.installedAt ?? now,
		updatedAt: now,
		...(installedBy.size
			? { installedBy: Array.from(installedBy).sort() }
			: {}),
	};
	await writePluginsConfig(scope, config, options.projectRoot);

	if (options.enabled ?? true) {
		await syncPluginSkillsToAgentsDir(
			joinPath(pluginsDir, manifest.name),
			manifest,
			scope,
			options.projectRoot,
		);
	} else {
		await removeSyncedPluginSkills(manifest.name, scope, options.projectRoot);
	}

	await installPluginDependencies(manifest, scope, options, context);

	return readDiscoveredPlugin(scope, pluginsDir, manifest.name, config);
}

/**
 * Install a plugin's declared dependencies from configured registries.
 * Dependencies already visited in this install run are skipped (cycle
 * guard), already-installed dependencies only gain provenance, and
 * dependencies whose registry entry targets other platforms are skipped.
 */
async function installPluginDependencies(
	manifest: PluginManifest,
	scope: PluginScope,
	options: PluginInstallOptions,
	context: PluginInstallContext,
): Promise<void> {
	for (const dependency of manifest.dependencies ?? []) {
		if (context.visited.has(dependency)) continue;
		context.visited.add(dependency);

		const config = await loadPluginsConfig(scope, options.projectRoot);
		const existing = await readDiscoveredPlugin(
			scope,
			getPluginsDir(scope, options.projectRoot),
			dependency,
			config,
		);
		if (existing.status === 'installed') {
			await recordPluginInstalledBy(
				dependency,
				manifest.name,
				scope,
				options.projectRoot,
			);
			continue;
		}

		try {
			const { entry } = await resolveRegistryPlugin(dependency, options);
			if (
				entry.platforms &&
				!(entry.platforms as string[]).includes(process.platform)
			) {
				continue;
			}
			await installPluginWithContext(
				dependency,
				{ ...options, scope },
				{ visited: context.visited, installedBy: manifest.name },
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Failed to install dependency "${dependency}" of plugin "${manifest.name}": ${message}`,
			);
		}
	}
}

/** Record that a plugin was requested as a dependency of another plugin. */
async function recordPluginInstalledBy(
	name: string,
	parent: string,
	scope: PluginScope,
	projectRoot?: string,
): Promise<void> {
	const config = await loadPluginsConfig(scope, projectRoot);
	const entry = config.plugins[name];
	if (!entry) return;
	const installedBy = new Set(entry.installedBy ?? []);
	if (installedBy.has(parent)) return;
	installedBy.add(parent);
	config.plugins[name] = {
		...entry,
		installedBy: Array.from(installedBy).sort(),
	};
	await writePluginsConfig(scope, config, projectRoot);
}

/** Remove an installed plugin payload and config entry. */
export async function removePlugin(
	name: string,
	options: { scope?: PluginScope; projectRoot?: string } = {},
): Promise<void> {
	const scope = options.scope ?? 'global';
	const config = await loadPluginsConfig(scope, options.projectRoot);
	delete config.plugins[name];
	for (const [pluginName, entry] of Object.entries(config.plugins)) {
		if (!entry.installedBy?.includes(name)) continue;
		const installedBy = entry.installedBy.filter((parent) => parent !== name);
		config.plugins[pluginName] = {
			...entry,
			...(installedBy.length ? { installedBy } : { installedBy: undefined }),
		};
	}
	await writePluginsConfig(scope, config, options.projectRoot);
	await rm(joinPath(getPluginsDir(scope, options.projectRoot), name), {
		recursive: true,
		force: true,
	});
	await removeSyncedPluginSkills(name, scope, options.projectRoot);
}

/** Enable or disable a plugin in the selected scope. */
export async function setPluginEnabled(
	name: string,
	enabled: boolean,
	options: { scope?: PluginScope; projectRoot?: string } = {},
): Promise<PluginsConfig> {
	const scope = options.scope ?? 'global';
	const config = await loadPluginsConfig(scope, options.projectRoot);
	config.plugins[name] = {
		...config.plugins[name],
		enabled,
	};
	await writePluginsConfig(scope, config, options.projectRoot);

	if (enabled) {
		const plugin = await readDiscoveredPlugin(
			scope,
			getPluginsDir(scope, options.projectRoot),
			name,
			config,
		);
		if (plugin.status === 'installed' && plugin.manifest) {
			await syncPluginSkillsToAgentsDir(
				plugin.dir,
				plugin.manifest,
				scope,
				options.projectRoot,
			);
		}
	} else {
		await removeSyncedPluginSkills(name, scope, options.projectRoot);
	}
	return config;
}

/** Update an installed registry plugin by reinstalling its recorded source. */
export async function updatePlugin(
	name: string,
	options: PluginInstallOptions = {},
): Promise<DiscoveredPlugin> {
	const scope = options.scope ?? 'global';
	const config = await loadPluginsConfig(scope, options.projectRoot);
	const source = config.plugins[name]?.source;
	if (source?.startsWith('local:')) {
		return installPlugin(source.slice('local:'.length), {
			...options,
			scope,
			enabled: config.plugins[name]?.enabled,
		});
	}
	return installPlugin(name, {
		...options,
		scope,
		enabled: config.plugins[name]?.enabled,
	});
}
