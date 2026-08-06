import {
	clearProjectToolDiscoveryCache,
	disposeNativeExtensionHosts,
	fetchPluginRegistry,
	getGlobalPluginsConfigPath,
	getGlobalPluginsDir,
	getProjectPluginsConfigPath,
	getProjectPluginsDir,
	installPlugin,
	loadPluginsConfig,
	pluginManifestSchema,
	pluginNameSchema,
	removePlugin,
	resolveEffectivePlugins,
	setPluginEnabled,
	updatePlugin,
	validateNativePlugin,
	writePluginsConfig,
	type DiscoveredPlugin,
	type PluginManifest,
	type PluginScope,
} from '@ottocode/sdk';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { getAllAgentDetails } from '../agent/config-management.ts';
import type { ForgeInput, ForgePlan, ForgeScope } from './types.ts';

function pluginScope(input: ForgeInput): PluginScope {
	return input.scope ?? 'project';
}

function pluginName(input: ForgeInput): string {
	const name = input.name?.trim().toLowerCase();
	if (!name) throw new Error('name is required for plugin actions');
	if (!pluginNameSchema.safeParse(name).success) {
		throw new Error(
			'Invalid plugin name. Use letters, numbers, dots, underscores, or hyphens.',
		);
	}
	return name;
}

export function pluginDirForScope(
	projectRoot: string,
	scope: ForgeScope,
	name: string,
): string {
	return resolve(
		scope === 'project'
			? getProjectPluginsDir(projectRoot)
			: getGlobalPluginsDir(),
		name,
	);
}

function configPathForScope(projectRoot: string, scope: ForgeScope): string {
	return scope === 'project'
		? getProjectPluginsConfigPath(projectRoot)
		: getGlobalPluginsConfigPath();
}

export function resetForgePluginRuntime(
	projectRoot: string,
	scope: ForgeScope,
): void {
	const root = scope === 'project' ? projectRoot : undefined;
	disposeNativeExtensionHosts(root);
	clearProjectToolDiscoveryCache(root);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function atomicWriteForgeJson(
	path: string,
	value: unknown,
): Promise<void> {
	const temporaryPath = `${path}.forge-${crypto.randomUUID()}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
	try {
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

export async function resolveForgePlugin(
	projectRoot: string,
	name: string,
	scope?: ForgeScope,
): Promise<DiscoveredPlugin> {
	const effective = await resolveEffectivePlugins(projectRoot);
	const candidates =
		scope === 'project'
			? effective.project.plugins
			: scope === 'global'
				? effective.global.plugins
				: effective.plugins;
	const plugin = candidates.find((item) => item.name === name);
	if (!plugin) {
		throw new Error(
			`Plugin '${name}' was not found${scope ? ` in ${scope} scope` : ''}`,
		);
	}
	return plugin;
}

export function assertForgePluginMutable(plugin: DiscoveredPlugin): void {
	const source = plugin.configEntry?.source;
	if (source?.startsWith('official:') || source?.startsWith('registry:')) {
		throw new Error(
			`Plugin '${plugin.name}' is registry-managed. Create or install a local fork before editing its manifest.`,
		);
	}
}

function hasMetadataUpdates(input: ForgeInput): boolean {
	return [
		input.version,
		input.displayName,
		input.publisher,
		input.description,
		input.homepage,
		input.repository,
		input.platforms,
		input.tags,
		input.dependencies,
		input.requirements,
	].some((value) => value !== undefined);
}

function applyManifestMetadata(
	manifest: Record<string, unknown>,
	input: ForgeInput,
): Record<string, unknown> {
	const next = { ...manifest };
	const updates: Array<[string, unknown]> = [
		['version', input.version],
		['displayName', input.displayName],
		['publisher', input.publisher],
		['description', input.description],
		['homepage', input.homepage],
		['repository', input.repository],
		['platforms', input.platforms],
		['tags', input.tags],
		['dependencies', input.dependencies],
		['requirements', input.requirements],
	];
	for (const [key, value] of updates) {
		if (value !== undefined) next[key] = value;
	}
	return next;
}

async function removalImpacts(
	projectRoot: string,
	plugin: DiscoveredPlugin,
): Promise<string[]> {
	const manifest = plugin.manifest;
	const toolPrefix = `${plugin.name}__`;
	const agentDetails = await getAllAgentDetails(projectRoot);
	const agents = agentDetails.agents
		.filter((agent) =>
			[...agent.toolConfig.firstClass, ...agent.toolConfig.loadable].some(
				(tool) => tool.startsWith(toolPrefix),
			),
		)
		.map((agent) => agent.name);
	const impacts: string[] = [];
	if (manifest?.recipes?.length)
		impacts.push(`${manifest.recipes.length} recipe contribution(s)`);
	if (manifest?.skills?.length)
		impacts.push(`${manifest.skills.length} skill contribution(s)`);
	if (manifest?.agents?.length)
		impacts.push(`${manifest.agents.length} agent contribution(s)`);
	if (manifest?.tools?.length)
		impacts.push(`${manifest.tools.length} native tool(s)`);
	const commands = Object.keys(manifest?.commands ?? {}).length;
	if (commands) impacts.push(`${commands} terminal slash command(s)`);
	if (agents.length) impacts.push(`referenced by agents: ${agents.join(', ')}`);
	return impacts;
}

function summarizePlugin(plugin: DiscoveredPlugin) {
	return {
		name: plugin.name,
		scope: plugin.scope,
		dir: plugin.dir,
		manifestPath: plugin.manifestPath,
		enabled: plugin.enabled,
		installed: plugin.installed,
		status: plugin.status,
		source: plugin.configEntry?.source,
		version: plugin.manifest?.version ?? plugin.configEntry?.version,
		description: plugin.manifest?.description,
		capabilities: {
			recipes: plugin.manifest?.recipes?.length ?? 0,
			skills: plugin.manifest?.skills?.length ?? 0,
			agents: plugin.manifest?.agents?.length ?? 0,
			commands: Object.keys(plugin.manifest?.commands ?? {}).length,
			tools: plugin.manifest?.tools?.length ?? 0,
			mcpServers: Object.keys(plugin.manifest?.mcpServers ?? {}).length,
		},
		...(plugin.error ? { error: plugin.error } : {}),
	};
}

async function createLocalPlugin(projectRoot: string, input: ForgeInput) {
	const name = pluginName(input);
	const scope = pluginScope(input);
	const dir = pluginDirForScope(projectRoot, scope, name);
	const manifestPath = resolve(dir, 'otto.plugin.json');
	if (await pathExists(dir)) {
		throw new Error(`Plugin '${name}' already exists in ${scope} scope`);
	}
	const manifest = pluginManifestSchema.parse({
		name,
		version: input.version?.trim() || '0.1.0',
		...(input.displayName ? { displayName: input.displayName } : {}),
		...(input.publisher ? { publisher: input.publisher } : {}),
		...(input.description ? { description: input.description } : {}),
		...(input.homepage ? { homepage: input.homepage } : {}),
		...(input.repository ? { repository: input.repository } : {}),
		...(input.platforms ? { platforms: input.platforms } : {}),
		...(input.tags ? { tags: input.tags } : {}),
		...(input.dependencies ? { dependencies: input.dependencies } : {}),
		...(input.requirements ? { requirements: input.requirements } : {}),
	});
	const plan: ForgePlan = {
		action: 'create',
		target: { kind: 'plugin', scope, name, paths: [manifestPath] },
		exists: false,
		changes: [
			`Create local ${scope} plugin '${name}'`,
			`Register plugin as enabled in ${configPathForScope(projectRoot, scope)}`,
		],
		preview: JSON.stringify(manifest, null, 2),
	};
	if (input.action === 'plan' || input.dryRun) {
		return { ok: true, applied: false, plan };
	}
	await mkdir(dir, { recursive: true });
	await atomicWriteForgeJson(manifestPath, manifest);
	const config = await loadPluginsConfig(scope, projectRoot);
	const now = new Date().toISOString();
	config.plugins[name] = {
		enabled: true,
		source: `local-authored:${dir}`,
		version: manifest.version,
		installedAt: now,
		updatedAt: now,
	};
	await writePluginsConfig(scope, config, projectRoot);
	resetForgePluginRuntime(projectRoot, scope);
	return {
		ok: true,
		applied: true,
		plan,
		plugin: summarizePlugin(await resolveForgePlugin(projectRoot, name, scope)),
	};
}

async function installExistingPlugin(projectRoot: string, input: ForgeInput) {
	const sourceInput = input.source?.trim() || input.name?.trim();
	if (!sourceInput) throw new Error('source is required to install a plugin');
	const scope = pluginScope(input);
	const source =
		!isAbsolute(sourceInput) &&
		(sourceInput.startsWith('.') || sourceInput.includes('/'))
			? resolve(projectRoot, sourceInput)
			: sourceInput;
	const plan = {
		action: 'install' as const,
		target: {
			kind: 'plugin' as const,
			scope,
			name: input.name?.trim() || source,
			paths: [configPathForScope(projectRoot, scope)],
		},
		exists: false,
		changes: [`Install plugin from '${source}' into ${scope} scope`],
	};
	if (input.dryRun) return { ok: true, applied: false, plan };
	const plugin = await installPlugin(source, {
		scope,
		projectRoot,
		enabled: true,
		...(input.url ? { url: input.url } : {}),
	});
	resetForgePluginRuntime(projectRoot, scope);
	return { ok: true, applied: true, plan, plugin: summarizePlugin(plugin) };
}

export async function runForgePluginAction(
	projectRoot: string,
	input: ForgeInput,
) {
	if (input.action === 'search') {
		const registry = await fetchPluginRegistry(
			input.url ? { url: input.url } : undefined,
		);
		const query = input.query?.trim().toLowerCase();
		const plugins = registry.plugins.filter((plugin) => {
			if (!query) return true;
			return [
				plugin.name,
				plugin.displayName,
				plugin.description,
				...(plugin.tags ?? []),
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(query);
		});
		return { ok: true, query, plugins: plugins.slice(0, 50) };
	}
	if (
		input.action === 'create' ||
		(input.action === 'plan' && input.targetAction === 'create')
	) {
		return createLocalPlugin(projectRoot, input);
	}
	if (input.action === 'install')
		return installExistingPlugin(projectRoot, input);

	const name = pluginName(input);
	const scope = pluginScope(input);
	const plugin = await resolveForgePlugin(projectRoot, name, scope);
	if (input.action === 'status') {
		return { ok: true, plugin: summarizePlugin(plugin) };
	}
	if (input.action === 'validate') {
		const validation = await validateNativePlugin(plugin.dir);
		return { ok: validation.ok, plugin: summarizePlugin(plugin), validation };
	}

	const action = input.action === 'plan' ? input.targetAction : input.action;
	if (!action || !['update', 'remove'].includes(action)) {
		if (input.action !== 'enable' && input.action !== 'disable') {
			throw new Error(`Action '${input.action}' is not supported for plugin`);
		}
	}
	const impacts =
		action === 'remove' ? await removalImpacts(projectRoot, plugin) : [];
	const plan: ForgePlan = {
		action:
			input.action === 'enable' || input.action === 'disable'
				? input.action
				: (action as 'update' | 'remove'),
		target: {
			kind: 'plugin',
			scope,
			name,
			paths: [plugin.manifestPath, configPathForScope(projectRoot, scope)],
		},
		exists: true,
		changes: [
			`${input.action === 'plan' ? action : input.action} plugin '${name}'`,
			...impacts.map((impact) => `Affected: ${impact}`),
		],
	};
	if (input.action === 'plan' || input.dryRun) {
		return { ok: true, applied: false, plan };
	}

	if (input.action === 'remove') {
		await removePlugin(name, { scope, projectRoot });
		resetForgePluginRuntime(projectRoot, scope);
		return { ok: true, applied: true, plan, impacts };
	}
	if (input.action === 'enable' || input.action === 'disable') {
		await setPluginEnabled(name, input.action === 'enable', {
			scope,
			projectRoot,
		});
		resetForgePluginRuntime(projectRoot, scope);
		return {
			ok: true,
			applied: true,
			plan,
			plugin: summarizePlugin(
				await resolveForgePlugin(projectRoot, name, scope),
			),
		};
	}
	if (input.action === 'update' && hasMetadataUpdates(input)) {
		assertForgePluginMutable(plugin);
		const raw = JSON.parse(
			await readFile(plugin.manifestPath, 'utf8'),
		) as Record<string, unknown>;
		const next = applyManifestMetadata(raw, input);
		const parsed = pluginManifestSchema.parse(next) as PluginManifest;
		await atomicWriteForgeJson(plugin.manifestPath, next);
		const config = await loadPluginsConfig(scope, projectRoot);
		config.plugins[name] = {
			...config.plugins[name],
			enabled: config.plugins[name]?.enabled ?? true,
			version: parsed.version,
			updatedAt: new Date().toISOString(),
		};
		await writePluginsConfig(scope, config, projectRoot);
	} else if (plugin.configEntry?.source?.startsWith('local-authored:')) {
		const validation = await validateNativePlugin(plugin.dir);
		if (!validation.ok) throw new Error(validation.errors.join('\n'));
		const config = await loadPluginsConfig(scope, projectRoot);
		config.plugins[name] = {
			...config.plugins[name],
			enabled: config.plugins[name]?.enabled ?? true,
			updatedAt: new Date().toISOString(),
		};
		await writePluginsConfig(scope, config, projectRoot);
	} else {
		await updatePlugin(name, { scope, projectRoot });
	}
	resetForgePluginRuntime(projectRoot, scope);
	return {
		ok: true,
		applied: true,
		plan,
		plugin: summarizePlugin(await resolveForgePlugin(projectRoot, name, scope)),
	};
}
