import { cp, readdir, rm, rmdir } from 'node:fs/promises';
import { z } from 'zod/v3';
import {
	ensureDir,
	fileExists,
	getGlobalAgentsSkillsDir,
	getGlobalPluginsConfigPath,
	getGlobalPluginsDir,
	getProjectAgentsSkillsDir,
	getProjectPluginsConfigPath,
	getProjectPluginsDir,
	joinPath,
} from '../config/src/paths.ts';

export const pluginNameSchema = z
	.string()
	.min(1)
	.regex(/^[a-zA-Z0-9._-]+$/);

export const pluginPlatformSchema = z.enum(['darwin', 'linux', 'win32']);

export const pluginSourceSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('github'),
		repo: z.string().min(1),
		ref: z.string().optional(),
		path: z.string().min(1),
		include: z.array(z.string()).optional(),
		exclude: z.array(z.string()).optional(),
	}),
	z.object({
		type: z.literal('local'),
		path: z.string().min(1),
		include: z.array(z.string()).optional(),
		exclude: z.array(z.string()).optional(),
	}),
	z.object({
		type: z.literal('url'),
		url: z.string().url(),
	}),
]);

export const pluginSkillSchema = z
	.object({
		name: pluginNameSchema,
		path: z.string().min(1).optional(),
		description: z.string().optional(),
		source: pluginSourceSchema.optional(),
	})
	.refine((skill) => skill.path || skill.source, {
		message: 'Plugin skill requires either path or source',
	});

export const pluginRecipeSchema = z.object({
	name: pluginNameSchema,
	path: z.string().min(1),
	description: z.string().optional(),
});

const pluginAgentNameSchema = z
	.string()
	.min(1)
	.regex(/^[a-zA-Z0-9_-]+$/);

export const pluginAgentToolGroupsSchema = z.object({
	firstClass: z.array(z.string()).optional(),
	loadable: z.array(z.string()).optional(),
});

export const pluginAgentSchema = z
	.object({
		name: pluginAgentNameSchema,
		path: z.string().min(1).optional(),
		prompt: z.string().optional(),
		description: z.string().optional(),
		provider: z.string().optional(),
		model: z.string().optional(),
		tools: pluginAgentToolGroupsSchema.optional(),
		appendTools: pluginAgentToolGroupsSchema.optional(),
	})
	.refine((agent) => agent.path || agent.prompt, {
		message: 'Plugin agent requires either path or prompt',
	});

export const pluginCommandParameterSchema = z.object({
	type: z.enum(['string', 'number', 'boolean', 'enum']),
	description: z.string().optional(),
	required: z.boolean().optional(),
	default: z.union([z.string(), z.number(), z.boolean()]).optional(),
	values: z.array(z.string()).optional(),
});

export const pluginCommandSchema: z.ZodType<PluginCommand> = z.lazy(() =>
	z.object({
		label: z.string().optional(),
		description: z.string().optional(),
		command: z.string().min(1),
		args: z.array(z.string()).optional(),
		env: z.record(z.string()).optional(),
		cwd: z.string().optional(),
		parameters: z.record(pluginCommandParameterSchema).optional(),
		allowExtraArgs: z.boolean().optional(),
		fallback: pluginCommandSchema.optional(),
	}),
);

export const pluginRequirementSchema = z.object({
	kind: z.enum(['platform', 'command', 'env', 'toolchain']),
	value: z.string().min(1),
	message: z.string().optional(),
});

export const pluginToolEffectSchema = z.enum([
	'workspace-read',
	'workspace-write',
	'process',
	'network',
	'secrets',
	'external-write',
]);

export const pluginToolSecretSchema = z.object({
	name: pluginNameSchema,
	env: z
		.string()
		.min(1)
		.regex(/^[A-Z_][A-Z0-9_]*$/),
	description: z.string().optional(),
	required: z.boolean().default(true),
});

const pluginToolEntrySchema = z
	.string()
	.min(1)
	.refine(
		(entry) => {
			if (entry.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entry)) return false;
			return !entry.split(/[\\/]/).includes('..');
		},
		{ message: 'Plugin tool entry must stay within the plugin directory' },
	);

const jsonObjectSchema = z.record(z.unknown());

export const pluginToolSchema = z
	.object({
		name: pluginNameSchema,
		entry: pluginToolEntrySchema,
		description: z.string().min(1),
		inputSchema: jsonObjectSchema,
		outputSchema: jsonObjectSchema.optional(),
		effects: z.array(pluginToolEffectSchema).default([]),
		secrets: z.array(pluginToolSecretSchema).default([]),
		timeoutMs: z.number().int().min(100).max(900_000).default(120_000),
	})
	.superRefine((definition, context) => {
		if (
			definition.secrets.length > 0 &&
			!definition.effects.includes('secrets')
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['effects'],
				message: 'Tools declaring secrets must include the secrets effect',
			});
		}
	});

export const pluginManifestSchema = z.object({
	$schema: z.string().optional(),
	name: pluginNameSchema,
	displayName: z.string().optional(),
	publisher: z.string().optional(),
	version: z.string().min(1),
	description: z.string().optional(),
	homepage: z.string().optional(),
	repository: z.string().optional(),
	platforms: z.array(pluginPlatformSchema).optional(),
	tags: z.array(z.string()).optional(),
	skills: z.array(pluginSkillSchema).optional(),
	recipes: z.array(pluginRecipeSchema).optional(),
	agents: z.array(pluginAgentSchema).optional(),
	dependencies: z.array(pluginNameSchema).optional(),
	mcpServers: z.record(z.unknown()).optional(),
	commands: z.record(pluginCommandSchema).optional(),
	tools: z.array(pluginToolSchema).optional(),
	browser: z
		.object({
			previewUrl: z.string().optional(),
		})
		.optional(),
	requirements: z.array(pluginRequirementSchema).optional(),
});

export const pluginConfigEntrySchema = z.object({
	enabled: z.boolean(),
	source: z.string().optional(),
	version: z.string().optional(),
	installedAt: z.string().optional(),
	updatedAt: z.string().optional(),
	pinned: z.boolean().optional(),
	installedBy: z.array(z.string()).optional(),
});

export const pluginsConfigSchema = z.object({
	$schema: z.string().optional(),
	version: z.literal(1).default(1),
	registries: z.array(z.string()).default([]),
	plugins: z.record(pluginConfigEntrySchema).default({}),
});

export const pluginRegistrySourceSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('github'),
		repo: z.string().min(1),
		ref: z.string().optional(),
		path: z.string().min(1),
	}),
	z.object({
		type: z.literal('local'),
		path: z.string().min(1),
	}),
]);

export const pluginRegistryEntrySchema = pluginManifestSchema
	.pick({
		name: true,
		displayName: true,
		publisher: true,
		version: true,
		description: true,
		homepage: true,
		repository: true,
		platforms: true,
		tags: true,
		skills: true,
		recipes: true,
		agents: true,
		dependencies: true,
		mcpServers: true,
		commands: true,
		tools: true,
		browser: true,
		requirements: true,
	})
	.extend({
		official: z.boolean().optional(),
		source: pluginRegistrySourceSchema.optional(),
	});

export const pluginRegistrySchema = z.object({
	$schema: z.string().optional(),
	version: z.literal(1),
	plugins: z.array(pluginRegistryEntrySchema).default([]),
});

export const DEFAULT_PLUGIN_REGISTRY_URL =
	'https://raw.githubusercontent.com/nitishxyz/otto/main/packages/plugin-registry/registry.json';

export type PluginScope = 'global' | 'project';
export type PluginStatus = 'installed' | 'missing' | 'invalid';
export type PluginCommandParameterType =
	| 'string'
	| 'number'
	| 'boolean'
	| 'enum';

export type PluginCommandParameter = {
	type: PluginCommandParameterType;
	description?: string;
	required?: boolean;
	default?: string | number | boolean;
	values?: string[];
};

export type PluginCommand = {
	label?: string;
	description?: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	parameters?: Record<string, PluginCommandParameter>;
	allowExtraArgs?: boolean;
	fallback?: PluginCommand;
};
export type PluginTool = z.infer<typeof pluginToolSchema>;
export type PluginToolEffect = z.infer<typeof pluginToolEffectSchema>;
export type PluginToolSecret = z.infer<typeof pluginToolSecretSchema>;
export type PluginSource = z.infer<typeof pluginSourceSchema>;
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginConfigEntry = z.infer<typeof pluginConfigEntrySchema>;
export type PluginsConfig = z.infer<typeof pluginsConfigSchema>;
export type PluginRegistry = z.infer<typeof pluginRegistrySchema>;
export type PluginRegistryEntry = z.infer<typeof pluginRegistryEntrySchema>;

export type DiscoveredPlugin = {
	name: string;
	scope: PluginScope;
	dir: string;
	manifestPath: string;
	configEntry?: PluginConfigEntry;
	enabled: boolean;
	installed: boolean;
	status: PluginStatus;
	manifest?: PluginManifest;
	error?: string;
};

export type PluginsScopeState = {
	scope: PluginScope;
	configPath: string;
	pluginsDir: string;
	config: PluginsConfig;
	plugins: DiscoveredPlugin[];
};

export type EffectivePlugin = DiscoveredPlugin & {
	overriddenByProject?: boolean;
};

export type EffectivePlugins = {
	global: PluginsScopeState;
	project: PluginsScopeState;
	plugins: EffectivePlugin[];
};

export type FetchPluginRegistryOptions = {
	url?: string;
	fetch?: typeof fetch;
};

export type ResolveRegistryPluginOptions = FetchPluginRegistryOptions & {
	registries?: string[];
};

export type PluginInstallOptions = ResolveRegistryPluginOptions & {
	scope?: PluginScope;
	projectRoot?: string;
	enabled?: boolean;
};

/** Load the plugins.json control plane for a global or project scope. */
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

/** Discover configured and directory-installed plugin payloads. */
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

/** Fetch and validate a plugin registry payload. */
export async function fetchPluginRegistry(
	options: FetchPluginRegistryOptions = {},
): Promise<PluginRegistry> {
	const url = options.url ?? DEFAULT_PLUGIN_REGISTRY_URL;
	if (isLocalSource(url)) {
		const parsed = JSON.parse(await Bun.file(normalizeLocalSource(url)).text());
		return pluginRegistrySchema.parse(parsed);
	}

	const fetchImpl = options.fetch ?? fetch;
	const response = await fetchImpl(url);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch plugin registry ${url}: ${response.status}`,
		);
	}
	return pluginRegistrySchema.parse(await response.json());
}

/** Resolve a plugin name from configured registries. */
export async function resolveRegistryPlugin(
	name: string,
	options: ResolveRegistryPluginOptions = {},
): Promise<{ registryUrl: string; entry: PluginRegistryEntry }> {
	const registries = options.registries?.length
		? options.registries
		: [options.url ?? DEFAULT_PLUGIN_REGISTRY_URL];

	for (const registryUrl of registries) {
		const registry = await fetchPluginRegistry({
			url: registryUrl,
			fetch: options.fetch,
		});
		const entry = registry.plugins.find((plugin) => plugin.name === name);
		if (entry) return { registryUrl, entry };
	}

	throw new Error(`Plugin not found in registries: ${name}`);
}

/** Install a plugin from a registry name or local directory. */
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

async function readDiscoveredPlugin(
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

function getPluginsConfigPath(
	scope: PluginScope,
	projectRoot?: string,
): string {
	if (scope === 'global') return getGlobalPluginsConfigPath();
	if (!projectRoot)
		throw new Error('projectRoot is required for project plugins');
	return getProjectPluginsConfigPath(projectRoot);
}

function getPluginsDir(scope: PluginScope, projectRoot?: string): string {
	if (scope === 'global') return getGlobalPluginsDir();
	if (!projectRoot)
		throw new Error('projectRoot is required for project plugins');
	return getProjectPluginsDir(projectRoot);
}

const PLUGIN_SKILL_MARKER_FILE = '.otto-plugin';

function getAgentsSkillsDir(scope: PluginScope, projectRoot?: string): string {
	if (scope === 'global') return getGlobalAgentsSkillsDir();
	if (!projectRoot)
		throw new Error('projectRoot is required for project plugins');
	return getProjectAgentsSkillsDir(projectRoot);
}

function parentPath(path: string): string {
	const index = path.lastIndexOf('/');
	return index > 0 ? path.slice(0, index) : path;
}

/** Remove skills previously synced into .agents/skills for a plugin. */
async function removeSyncedPluginSkills(
	pluginName: string,
	scope: PluginScope,
	projectRoot?: string,
): Promise<void> {
	const skillsDir = getAgentsSkillsDir(scope, projectRoot);
	let entries: Awaited<ReturnType<typeof readdir>>;
	try {
		entries = await readdir(skillsDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dir = joinPath(skillsDir, entry.name);
		const marker = Bun.file(joinPath(dir, PLUGIN_SKILL_MARKER_FILE));
		try {
			if (!(await marker.exists())) continue;
			if ((await marker.text()).trim() !== pluginName) continue;
		} catch {
			continue;
		}
		await rm(dir, { recursive: true, force: true });
	}
	await removeDirIfEmpty(skillsDir);
}

async function removeDirIfEmpty(dir: string): Promise<void> {
	try {
		await rmdir(dir);
	} catch {}
}

/**
 * Re-sync all plugin skills into .agents/skills and remove synced skills
 * whose owning plugin is no longer installed and enabled. Use this to
 * backfill existing installs or clean up after manual plugin removal.
 */
export async function syncPluginSkills(projectRoot: string): Promise<void> {
	const discovered = await discoverPlugins(projectRoot);
	const activeByScope: Record<PluginScope, Map<string, DiscoveredPlugin>> = {
		global: new Map(),
		project: new Map(),
	};
	for (const scope of ['global', 'project'] as const) {
		for (const plugin of discovered[scope].plugins) {
			if (!plugin.enabled || plugin.status !== 'installed' || !plugin.manifest)
				continue;
			activeByScope[scope].set(plugin.name, plugin);
		}
	}

	for (const scope of ['global', 'project'] as const) {
		const scopeProjectRoot = scope === 'project' ? projectRoot : undefined;
		await removeOrphanedPluginSkills(
			activeByScope[scope],
			scope,
			scopeProjectRoot,
		);
		for (const plugin of activeByScope[scope].values()) {
			if (!plugin.manifest) continue;
			await syncPluginSkillsToAgentsDir(
				plugin.dir,
				plugin.manifest,
				scope,
				scopeProjectRoot,
			);
		}
	}
}

async function removeOrphanedPluginSkills(
	activePlugins: Map<string, DiscoveredPlugin>,
	scope: PluginScope,
	projectRoot?: string,
): Promise<void> {
	const skillsDir = getAgentsSkillsDir(scope, projectRoot);
	let entries: Awaited<ReturnType<typeof readdir>>;
	try {
		entries = await readdir(skillsDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dir = joinPath(skillsDir, entry.name);
		const marker = Bun.file(joinPath(dir, PLUGIN_SKILL_MARKER_FILE));
		let owner: string;
		try {
			if (!(await marker.exists())) continue;
			owner = (await marker.text()).trim();
		} catch {
			continue;
		}
		if (activePlugins.has(owner)) continue;
		await rm(dir, { recursive: true, force: true });
	}
	await removeDirIfEmpty(skillsDir);
}

/** Materialize plugin skills into .agents/skills so any harness can use them. */
async function syncPluginSkillsToAgentsDir(
	pluginDir: string,
	manifest: PluginManifest,
	scope: PluginScope,
	projectRoot?: string,
): Promise<void> {
	await removeSyncedPluginSkills(manifest.name, scope, projectRoot);
	if (!manifest.skills?.length) return;

	const skillsDir = getAgentsSkillsDir(scope, projectRoot);
	const normalizedPluginDir = normalizeSourcePattern(pluginDir);
	for (const skill of manifest.skills) {
		if (!skill.path) continue;
		const normalizedSkillPath = normalizeSourcePattern(skill.path);
		if (normalizedSkillPath.split('/').includes('..')) continue;

		const skillFile = joinPath(pluginDir, normalizedSkillPath);
		if (!(await fileExists(skillFile))) continue;

		const sourceDir = parentPath(skillFile);
		const targetDir = joinPath(skillsDir, skill.name);
		await rm(targetDir, { recursive: true, force: true });
		await ensureDir(targetDir);
		const skillFileName = skillFile.slice(skillFile.lastIndexOf('/') + 1);
		const targetSkillFile = joinPath(targetDir, 'SKILL.md');
		if (normalizeSourcePattern(sourceDir) === normalizedPluginDir) {
			await cp(skillFile, targetSkillFile, { force: true });
		} else {
			await cp(sourceDir, targetDir, { recursive: true, force: true });
			if (skillFileName !== 'SKILL.md') {
				await cp(joinPath(targetDir, skillFileName), targetSkillFile, {
					force: true,
				});
				await rm(joinPath(targetDir, skillFileName), { force: true });
			}
		}
		try {
			const content = await Bun.file(targetSkillFile).text();
			await Bun.write(
				targetSkillFile,
				normalizeSkillFrontmatter(content, skill.name, skill.description),
			);
		} catch {}
		await Bun.write(
			joinPath(targetDir, PLUGIN_SKILL_MARKER_FILE),
			`${manifest.name}\n`,
		);
	}
}

/**
 * Rewrite SKILL.md frontmatter so `name`/`description` match the plugin
 * manifest. Other harnesses read skill metadata from the frontmatter only,
 * so the synced copy must carry the effective values.
 */
function normalizeSkillFrontmatter(
	content: string,
	name: string,
	description?: string,
): string {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
	if (!match) {
		const head = [`name: ${name}`];
		if (description) head.push(`description: ${JSON.stringify(description)}`);
		return `---\n${head.join('\n')}\n---\n\n${content}`;
	}

	const lines = (match[1] ?? '').split(/\r?\n/);
	const kept: string[] = [];
	let hasName = false;
	let hasDescription = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (!/^\S/.test(line)) {
			kept.push(line);
			continue;
		}
		const colonIdx = line.indexOf(':');
		const key = colonIdx === -1 ? '' : line.slice(0, colonIdx).trim();
		const replaceName = key === 'name';
		const replaceDescription =
			key === 'description' && description !== undefined;
		if (key === 'name') hasName = true;
		if (key === 'description') hasDescription = true;
		if (!replaceName && !replaceDescription) {
			kept.push(line);
			continue;
		}
		while (index + 1 < lines.length && !/^\S/.test(lines[index + 1] ?? '')) {
			index += 1;
		}
		kept.push(
			replaceName
				? `name: ${name}`
				: `description: ${JSON.stringify(description)}`,
		);
	}
	if (!hasName) kept.unshift(`name: ${name}`);
	if (description !== undefined && !hasDescription) {
		kept.push(`description: ${JSON.stringify(description)}`);
	}
	return `---\n${kept.join('\n')}\n---\n${match[2] ?? ''}`;
}

function isLocalSource(source: string): boolean {
	return (
		source.startsWith('.') ||
		source.startsWith('/') ||
		source.startsWith('~') ||
		source.startsWith('file:')
	);
}

function normalizeLocalSource(source: string): string {
	if (source.startsWith('file://')) return new URL(source).pathname;
	if (source === '~') return process.env.HOME ?? source;
	if (source.startsWith('~/'))
		return joinPath(process.env.HOME ?? '~', source.slice(2));
	return source;
}

async function readPluginManifestFromDir(dir: string): Promise<PluginManifest> {
	const parsed = JSON.parse(
		await Bun.file(joinPath(dir, 'otto.plugin.json')).text(),
	);
	return pluginManifestSchema.parse(parsed);
}

async function copyPluginDir(
	sourceDir: string,
	targetDir: string,
): Promise<void> {
	await rm(targetDir, { recursive: true, force: true });
	await ensureDir(targetDir.slice(0, targetDir.lastIndexOf('/')));
	await cp(sourceDir, targetDir, { recursive: true, force: true });
}

function getLocalRegistryDirectory(registryUrl: string): string | null {
	if (!isLocalSource(registryUrl)) return null;
	const normalized = normalizeLocalSource(registryUrl);
	if (normalized.endsWith('/registry.json')) {
		return normalized.slice(0, -'/registry.json'.length);
	}
	const lastSlash = normalized.lastIndexOf('/');
	return lastSlash === -1 ? '.' : normalized.slice(0, lastSlash);
}

function isAbsoluteSourcePath(path: string): boolean {
	return (
		path.startsWith('/') ||
		path.startsWith('file:') ||
		/^[A-Za-z]:[\\/]/.test(path)
	);
}

function resolveRegistrySourcePath(
	sourcePath: string,
	localRegistryDir: string | null,
): string {
	if (isAbsoluteSourcePath(sourcePath) || sourcePath.startsWith('~')) {
		return normalizeLocalSource(sourcePath);
	}
	if (localRegistryDir) {
		return joinPath(localRegistryDir, sourcePath);
	}
	return sourcePath;
}

function resolveLocalRegistryGithubPayloadDir(
	entry: PluginRegistryEntry,
	source: Extract<PluginSource, { type: 'github' }>,
	localRegistryDir: string,
): string {
	const registryPrefix = 'packages/plugin-registry/';
	if (source.path.startsWith(registryPrefix)) {
		return joinPath(localRegistryDir, source.path.slice(registryPrefix.length));
	}
	return joinPath(localRegistryDir, 'official', entry.name);
}

async function installRegistryEntryPayload(
	entry: PluginRegistryEntry,
	targetDir: string,
	fetchImpl?: typeof fetch,
	registryUrl?: string,
): Promise<void> {
	const localRegistryDir = registryUrl
		? getLocalRegistryDirectory(registryUrl)
		: null;

	if (!entry.source) {
		await writeRegistryEntryPayload(entry, targetDir);
		return;
	}

	if (entry.source.type === 'local') {
		const sourcePath = resolveRegistrySourcePath(
			entry.source.path,
			localRegistryDir,
		);
		await copyPluginDir(sourcePath, targetDir);
		return;
	}

	if (entry.source.type === 'github' && localRegistryDir) {
		const localPayloadDir = resolveLocalRegistryGithubPayloadDir(
			entry,
			entry.source,
			localRegistryDir,
		);
		if (await fileExists(joinPath(localPayloadDir, 'otto.plugin.json'))) {
			await copyPluginDir(localPayloadDir, targetDir);
			return;
		}
	}

	await rm(targetDir, { recursive: true, force: true });
	await ensureDir(targetDir);
	await downloadGithubPath(entry.source, targetDir, fetchImpl ?? fetch);
}

async function writeRegistryEntryPayload(
	entry: PluginRegistryEntry,
	targetDir: string,
): Promise<void> {
	const { official: _official, source: _source, ...manifest } = entry;
	await rm(targetDir, { recursive: true, force: true });
	await ensureDir(targetDir);
	await Bun.write(
		joinPath(targetDir, 'otto.plugin.json'),
		`${JSON.stringify(pluginManifestSchema.parse(manifest), null, 2)}\n`,
	);
}

async function materializePluginSkillSources(
	pluginDir: string,
	manifest: PluginManifest,
	fetchImpl?: typeof fetch,
): Promise<PluginManifest> {
	if (!manifest.skills?.length) return manifest;

	let changed = false;
	const skills: PluginManifest['skills'] = [];
	for (const skill of manifest.skills) {
		if (skill.path || !skill.source) {
			skills.push(skill);
			continue;
		}

		const skillDir = joinPath(pluginDir, 'skills', skill.name);
		await installSkillSourcePayload(skill.source, skillDir, fetchImpl ?? fetch);
		skills.push({
			...skill,
			path: `skills/${skill.name}/SKILL.md`,
		});
		changed = true;
	}

	if (!changed) return manifest;

	const updated = pluginManifestSchema.parse({
		...manifest,
		skills,
	});
	await Bun.write(
		joinPath(pluginDir, 'otto.plugin.json'),
		`${JSON.stringify(updated, null, 2)}\n`,
	);
	return updated;
}

async function installSkillSourcePayload(
	source: PluginSource,
	targetDir: string,
	fetchImpl: typeof fetch,
): Promise<void> {
	await rm(targetDir, { recursive: true, force: true });
	await ensureDir(targetDir);

	if (source.type === 'local') {
		if (source.include?.length) {
			await copyIncludedLocalSource(
				source.path,
				targetDir,
				source.include,
				source.exclude,
			);
			return;
		}

		await cp(source.path, targetDir, { recursive: true, force: true });
		await removeExcludedSourcePaths(targetDir, source.exclude);
		return;
	}

	if (source.type === 'url') {
		const response = await fetchImpl(source.url);
		if (!response.ok) {
			throw new Error(`Failed to fetch plugin skill ${source.url}`);
		}
		await Bun.write(joinPath(targetDir, 'SKILL.md'), await response.text());
		return;
	}

	await downloadGithubPath(source, targetDir, fetchImpl, {
		include: source.include,
		exclude: source.exclude,
		rootPath: source.path,
	});
}

type DownloadGithubOptions = {
	include?: string[];
	exclude?: string[];
	rootPath: string;
};

async function downloadGithubPath(
	source: Extract<PluginSource, { type: 'github' }>,
	targetDir: string,
	fetchImpl: typeof fetch,
	options: DownloadGithubOptions = { rootPath: source.path },
): Promise<void> {
	const ref = source.ref ?? 'main';
	const apiUrl = `https://api.github.com/repos/${source.repo}/contents/${source.path}?ref=${encodeURIComponent(ref)}`;
	const response = await fetchImpl(apiUrl, {
		headers: { Accept: 'application/vnd.github+json' },
	});
	if (!response.ok) {
		throw new Error(
			`Failed to fetch plugin payload ${source.repo}/${source.path}`,
		);
	}
	const payload = await response.json();
	const githubEntrySchema = z.object({
		name: z.string(),
		path: z.string(),
		type: z.enum(['file', 'dir']),
		download_url: z.string().nullable().optional(),
	});

	if (!Array.isArray(payload)) {
		const entry = githubEntrySchema.parse(payload);
		const relativePath = githubRelativePath(entry.path, options.rootPath);
		if (
			!isIncludedSourcePath(relativePath, options.include) ||
			isExcludedSourcePath(relativePath, options.exclude)
		) {
			return;
		}
		if (entry.type !== 'file' || !entry.download_url) {
			throw new Error(`Unsupported GitHub payload ${entry.path}`);
		}
		const fileResponse = await fetchImpl(entry.download_url);
		if (!fileResponse.ok) {
			throw new Error(`Failed to download plugin file ${entry.path}`);
		}
		await Bun.write(joinPath(targetDir, entry.name), await fileResponse.text());
		return;
	}

	const entries = z.array(githubEntrySchema).parse(payload);

	for (const entry of entries) {
		const relativePath = githubRelativePath(entry.path, options.rootPath);
		if (isExcludedSourcePath(relativePath, options.exclude)) continue;

		const targetPath = joinPath(targetDir, entry.name);
		if (entry.type === 'dir') {
			if (!shouldVisitSourceDirectory(relativePath, options.include)) {
				continue;
			}
			await ensureDir(targetPath);
			await downloadGithubPath(
				{ ...source, path: entry.path, ref },
				targetPath,
				fetchImpl,
				options,
			);
			continue;
		}
		if (!isIncludedSourcePath(relativePath, options.include)) continue;

		if (!entry.download_url) {
			throw new Error(`Missing download URL for ${entry.path}`);
		}
		const fileResponse = await fetchImpl(entry.download_url);
		if (!fileResponse.ok) {
			throw new Error(`Failed to download plugin file ${entry.path}`);
		}
		await Bun.write(targetPath, await fileResponse.text());
	}
}

async function copyIncludedLocalSource(
	sourceDir: string,
	targetDir: string,
	include: string[],
	exclude: string[] | undefined,
	relativeDir = '',
): Promise<void> {
	for (const entry of await readdir(joinPath(sourceDir, relativeDir), {
		withFileTypes: true,
	})) {
		const relativePath = relativeDir
			? `${relativeDir}/${entry.name}`
			: entry.name;
		if (isExcludedSourcePath(relativePath, exclude)) continue;

		if (entry.isDirectory()) {
			if (shouldVisitSourceDirectory(relativePath, include)) {
				await copyIncludedLocalSource(
					sourceDir,
					targetDir,
					include,
					exclude,
					relativePath,
				);
			}
			continue;
		}

		if (!entry.isFile() || !isIncludedSourcePath(relativePath, include)) {
			continue;
		}

		const targetPath = joinPath(targetDir, relativePath);
		await ensureDir(targetPath.slice(0, targetPath.lastIndexOf('/')));
		await cp(joinPath(sourceDir, relativePath), targetPath, { force: true });
	}
}

async function removeExcludedSourcePaths(
	targetDir: string,
	exclude: string[] | undefined,
): Promise<void> {
	for (const pattern of exclude ?? []) {
		const normalized = normalizeSourcePattern(pattern);
		if (!normalized) continue;
		const path = normalized.endsWith('/**')
			? normalized.slice(0, -'/**'.length)
			: normalized;
		await rm(joinPath(targetDir, path), { recursive: true, force: true });
	}
}

function githubRelativePath(path: string, rootPath: string): string {
	const normalizedPath = normalizeSourcePattern(path);
	const normalizedRoot = normalizeSourcePattern(rootPath);
	if (normalizedPath === normalizedRoot) return '';
	if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
		return normalizedPath.slice(normalizedRoot.length + 1);
	}
	return normalizedPath;
}

function isExcludedSourcePath(
	path: string,
	exclude: string[] | undefined,
): boolean {
	const normalizedPath = normalizeSourcePattern(path);
	if (!normalizedPath) return false;

	return (exclude ?? []).some((pattern) => {
		const normalizedPattern = normalizeSourcePattern(pattern);
		if (!normalizedPattern) return false;
		if (normalizedPattern.endsWith('/**')) {
			const prefix = normalizedPattern.slice(0, -'/**'.length);
			return (
				normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
			);
		}
		return normalizedPath === normalizedPattern;
	});
}

function isIncludedSourcePath(
	path: string,
	include: string[] | undefined,
): boolean {
	if (!include?.length) return true;
	const normalizedPath = normalizeSourcePattern(path);
	if (!normalizedPath) return false;

	return include.some((pattern) => {
		const normalizedPattern = normalizeSourcePattern(pattern);
		if (!normalizedPattern) return false;
		if (normalizedPattern.endsWith('/**')) {
			const prefix = normalizedPattern.slice(0, -'/**'.length);
			return normalizedPath.startsWith(`${prefix}/`);
		}
		return normalizedPath === normalizedPattern;
	});
}

function shouldVisitSourceDirectory(
	path: string,
	include: string[] | undefined,
): boolean {
	if (!include?.length) return true;
	const normalizedPath = normalizeSourcePattern(path);
	if (!normalizedPath) return true;

	return include.some((pattern) => {
		const normalizedPattern = normalizeSourcePattern(pattern);
		if (!normalizedPattern) return false;
		const prefix = normalizedPattern.endsWith('/**')
			? normalizedPattern.slice(0, -'/**'.length)
			: normalizedPattern;
		return (
			prefix === normalizedPath ||
			prefix.startsWith(`${normalizedPath}/`) ||
			normalizedPath.startsWith(`${prefix}/`)
		);
	});
}

function normalizeSourcePattern(value: string): string {
	return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}
