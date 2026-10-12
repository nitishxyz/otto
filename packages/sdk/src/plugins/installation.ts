import { rename, rmdir, stat } from 'node:fs/promises';
import { ensureDir, joinPath } from '../config/src/paths.ts';
import { reconcileMCPManagers } from '../core/src/mcp/lifecycle.ts';
import { loadPluginsConfig, updatePluginsConfig } from './config.ts';
import { getPluginsDir, readDiscoveredPlugin } from './discovery.ts';
import {
	assertStrictDescendant,
	removeDescendantPath,
	serializeByKey,
} from './fs-safety.ts';
import { resolveRegistryPlugin } from './registry.ts';
import { pluginNameSchema } from './schema.ts';
import type {
	DiscoveredPlugin,
	PluginInstallOptions,
	PluginManifest,
	PluginRegistryEntry,
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

type StagedPlugin = {
	name: string;
	manifest: PluginManifest;
	stagedDir: string;
	sourceLabel: string;
	installedBy?: string;
};

type StageContext = {
	scope: PluginScope;
	pluginsDir: string;
	stagingRoot: string;
	options: PluginInstallOptions;
	config: PluginsConfig;
	visited: Set<string>;
	staged: Map<string, StagedPlugin>;
	/** Already-installed dependencies that only gain provenance. */
	provenance: Array<{ name: string; parent: string }>;
};

function assertPluginName(name: string): void {
	if (!pluginNameSchema.safeParse(name).success) {
		throw new Error(`Invalid plugin name '${name}'`);
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function parentPath(path: string): string {
	const index = path.lastIndexOf('/');
	return index > 0 ? path.slice(0, index) : path;
}

function installLockKey(pluginsDir: string): string {
	return `plugins-install:${pluginsDir}`;
}

function reconcileScope(scope: PluginScope, projectRoot?: string) {
	return reconcileMCPManagers(scope === 'project' ? projectRoot : undefined);
}

/**
 * Install a plugin and its missing dependency closure. Every payload is
 * staged and validated first; nothing in the live plugins directory or
 * plugins.json changes unless the whole closure stages successfully. Promotion
 * swaps directories with rollback, so a failure keeps the previous version.
 */
export async function installPlugin(
	source: string,
	options: PluginInstallOptions = {},
): Promise<DiscoveredPlugin> {
	const scope = options.scope ?? (isLocalSource(source) ? 'project' : 'global');
	const pluginsDir = getPluginsDir(scope, options.projectRoot);
	const installed = await serializeByKey(installLockKey(pluginsDir), () =>
		installPluginLocked(source, scope, pluginsDir, options),
	);
	await reconcileScope(scope, options.projectRoot);
	return installed;
}

async function installPluginLocked(
	source: string,
	scope: PluginScope,
	pluginsDir: string,
	options: PluginInstallOptions,
): Promise<DiscoveredPlugin> {
	const stagingBase = joinPath(parentPath(pluginsDir), '.plugin-staging');
	const stagingRoot = joinPath(stagingBase, crypto.randomUUID());
	const ctx: StageContext = {
		scope,
		pluginsDir,
		stagingRoot,
		options,
		config: await loadPluginsConfig(scope, options.projectRoot),
		visited: new Set(),
		staged: new Map(),
		provenance: [],
	};
	try {
		const root = isLocalSource(source)
			? await stageLocalPlugin(normalizeLocalSource(source), ctx)
			: await stageRegistryPlugin(source, ctx);
		const pinned = ctx.config.plugins[root.name];
		if (
			pinned?.pinned &&
			(await pathExists(joinPath(pluginsDir, root.name))) &&
			pinned.version !== root.manifest.version
		) {
			throw new Error(
				`Plugin "${root.name}" is pinned to version ${pinned.version ?? 'current'}; unpin it before installing ${root.manifest.version}`,
			);
		}
		await promoteStagedPlugins(ctx);

		const enabled = ctx.options.enabled ?? true;
		for (const plugin of ctx.staged.values()) {
			const dir = joinPath(pluginsDir, plugin.name);
			if (enabled) {
				await syncPluginSkillsToAgentsDir(
					dir,
					plugin.manifest,
					scope,
					options.projectRoot,
				);
			} else {
				await removeSyncedPluginSkills(plugin.name, scope, options.projectRoot);
			}
		}

		return readDiscoveredPlugin(
			scope,
			pluginsDir,
			root.name,
			await loadPluginsConfig(scope, options.projectRoot),
		);
	} finally {
		await removeDescendantPath(stagingBase, stagingRoot).catch(() => {});
		await rmdir(stagingBase).catch(() => {});
	}
}

async function stageLocalPlugin(
	sourceDir: string,
	ctx: StageContext,
	installedBy?: string,
): Promise<StagedPlugin> {
	const manifest = await readPluginManifestFromDir(sourceDir);
	const stagedDir = joinPath(ctx.stagingRoot, crypto.randomUUID());
	await copyPluginDir(sourceDir, stagedDir);
	return finishStaging(stagedDir, manifest, `local:${sourceDir}`, ctx, {
		installedBy,
	});
}

async function stageRegistryPlugin(
	name: string,
	ctx: StageContext,
	resolved?: { registryUrl: string; entry: PluginRegistryEntry },
	installedBy?: string,
): Promise<StagedPlugin> {
	const { registryUrl, entry } =
		resolved ?? (await resolveRegistryPlugin(name, ctx.options));
	const stagedDir = joinPath(ctx.stagingRoot, crypto.randomUUID());
	await installRegistryEntryPayload(
		entry,
		stagedDir,
		ctx.options.fetch,
		registryUrl,
	);
	const manifest = await readPluginManifestFromDir(stagedDir);
	if (manifest.name !== entry.name) {
		throw new Error(
			`Registry entry "${entry.name}" installed a payload named "${manifest.name}"`,
		);
	}
	return finishStaging(
		stagedDir,
		manifest,
		entry.official ? `official:${entry.name}` : `registry:${entry.name}`,
		ctx,
		{ installedBy },
	);
}

async function finishStaging(
	stagedDir: string,
	rawManifest: PluginManifest,
	sourceLabel: string,
	ctx: StageContext,
	meta: { installedBy?: string },
): Promise<StagedPlugin> {
	assertPluginName(rawManifest.name);
	assertStrictDescendant(
		ctx.pluginsDir,
		joinPath(ctx.pluginsDir, rawManifest.name),
	);
	const manifest = await materializePluginSkillSources(
		stagedDir,
		rawManifest,
		ctx.options.fetch,
	);
	const staged: StagedPlugin = {
		name: manifest.name,
		manifest,
		stagedDir,
		sourceLabel,
		...(meta.installedBy ? { installedBy: meta.installedBy } : {}),
	};
	ctx.visited.add(manifest.name);
	ctx.staged.set(manifest.name, staged);
	await stagePluginDependencies(manifest, ctx);
	return staged;
}

/**
 * Stage a plugin's declared dependencies from configured registries.
 * Dependencies already visited in this install run are skipped (cycle
 * guard), already-installed dependencies only gain provenance, and
 * dependencies whose registry entry targets other platforms are skipped.
 */
async function stagePluginDependencies(
	manifest: PluginManifest,
	ctx: StageContext,
): Promise<void> {
	for (const dependency of manifest.dependencies ?? []) {
		if (ctx.visited.has(dependency)) continue;
		ctx.visited.add(dependency);

		const existing = await readDiscoveredPlugin(
			ctx.scope,
			ctx.pluginsDir,
			dependency,
			ctx.config,
		);
		if (existing.status === 'installed') {
			ctx.provenance.push({ name: dependency, parent: manifest.name });
			continue;
		}

		try {
			const resolved = await resolveRegistryPlugin(dependency, ctx.options);
			if (
				resolved.entry.platforms &&
				!(resolved.entry.platforms as string[]).includes(process.platform)
			) {
				continue;
			}
			await stageRegistryPlugin(dependency, ctx, resolved, manifest.name);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Failed to install dependency "${dependency}" of plugin "${manifest.name}": ${message}`,
			);
		}
	}
}

type Promotion = { target: string; backup?: string };

async function rollbackPromotions(
	ctx: StageContext,
	promoted: Promotion[],
): Promise<void> {
	for (const item of [...promoted].reverse()) {
		await removeDescendantPath(ctx.pluginsDir, item.target).catch(() => {});
		if (item.backup) await rename(item.backup, item.target).catch(() => {});
	}
}

/**
 * Swap every staged payload into place, then register the closure in
 * plugins.json in one serialized write. Any failure restores previous
 * payloads; dependencies are always promoted before their parents register.
 */
async function promoteStagedPlugins(ctx: StageContext): Promise<void> {
	const promoted: Promotion[] = [];
	const staged = Array.from(ctx.staged.values()).reverse();
	try {
		await ensureDir(ctx.pluginsDir);
		for (const plugin of staged) {
			const target = assertStrictDescendant(
				ctx.pluginsDir,
				joinPath(ctx.pluginsDir, plugin.name),
			);
			const promotion: Promotion = { target };
			if (await pathExists(target)) {
				promotion.backup = joinPath(
					ctx.stagingRoot,
					`${crypto.randomUUID()}.backup`,
				);
				await rename(target, promotion.backup);
			}
			promoted.push(promotion);
			await rename(plugin.stagedDir, target);
		}

		const now = new Date().toISOString();
		const enabled = ctx.options.enabled ?? true;
		await updatePluginsConfig(ctx.scope, ctx.options.projectRoot, (config) => {
			for (const plugin of staged) {
				const previous = config.plugins[plugin.name];
				const installedBy = new Set(previous?.installedBy ?? []);
				if (plugin.installedBy) installedBy.add(plugin.installedBy);
				config.plugins[plugin.name] = {
					...(previous?.pinned ? { pinned: previous.pinned } : {}),
					enabled,
					source: plugin.sourceLabel,
					version: plugin.manifest.version,
					installedAt: previous?.installedAt ?? now,
					updatedAt: now,
					...(installedBy.size
						? { installedBy: Array.from(installedBy).sort() }
						: {}),
				};
			}
			for (const { name, parent } of ctx.provenance) {
				const entry = config.plugins[name];
				if (!entry) continue;
				const installedBy = new Set(entry.installedBy ?? []);
				installedBy.add(parent);
				config.plugins[name] = {
					...entry,
					installedBy: Array.from(installedBy).sort(),
				};
			}
		});
	} catch (error) {
		await rollbackPromotions(ctx, promoted);
		throw error;
	}
	for (const item of promoted) {
		if (item.backup) {
			await removeDescendantPath(ctx.stagingRoot, item.backup).catch(() => {});
		}
	}
}

/** Remove an installed plugin payload and config entry. */
export async function removePlugin(
	name: string,
	options: { scope?: PluginScope; projectRoot?: string } = {},
): Promise<void> {
	assertPluginName(name);
	const scope = options.scope ?? 'global';
	const pluginsDir = getPluginsDir(scope, options.projectRoot);
	await serializeByKey(installLockKey(pluginsDir), async () => {
		await updatePluginsConfig(scope, options.projectRoot, (config) => {
			delete config.plugins[name];
			for (const [pluginName, entry] of Object.entries(config.plugins)) {
				if (!entry.installedBy?.includes(name)) continue;
				const installedBy = entry.installedBy.filter(
					(parent) => parent !== name,
				);
				config.plugins[pluginName] = {
					...entry,
					...(installedBy.length
						? { installedBy }
						: { installedBy: undefined }),
				};
			}
		});
		await removeDescendantPath(pluginsDir, joinPath(pluginsDir, name));
		await removeSyncedPluginSkills(name, scope, options.projectRoot);
	});
	await reconcileScope(scope, options.projectRoot);
}

/** Enable or disable a plugin in the selected scope. */
export async function setPluginEnabled(
	name: string,
	enabled: boolean,
	options: { scope?: PluginScope; projectRoot?: string } = {},
): Promise<PluginsConfig> {
	assertPluginName(name);
	const scope = options.scope ?? 'global';
	const config = await updatePluginsConfig(
		scope,
		options.projectRoot,
		(current) => {
			current.plugins[name] = {
				...current.plugins[name],
				enabled,
			};
		},
	);

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
	await reconcileScope(scope, options.projectRoot);
	return config;
}

/**
 * Update an installed registry plugin by reinstalling its recorded source.
 * Pinned plugins are left untouched.
 */
export async function updatePlugin(
	name: string,
	options: PluginInstallOptions = {},
): Promise<DiscoveredPlugin> {
	assertPluginName(name);
	const scope = options.scope ?? 'global';
	const config = await loadPluginsConfig(scope, options.projectRoot);
	const entry = config.plugins[name];
	if (entry?.pinned) {
		return readDiscoveredPlugin(
			scope,
			getPluginsDir(scope, options.projectRoot),
			name,
			config,
		);
	}
	const source = entry?.source;
	if (source?.startsWith('local:')) {
		return installPlugin(source.slice('local:'.length), {
			...options,
			scope,
			enabled: entry?.enabled,
		});
	}
	return installPlugin(name, {
		...options,
		scope,
		enabled: entry?.enabled,
	});
}
