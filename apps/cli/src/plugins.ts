import {
	DEFAULT_PLUGIN_REGISTRY_URL,
	fetchPluginRegistry,
	installPlugin,
	removePlugin,
	resolveEffectivePlugins,
	resolveRegistryPlugin,
	setPluginEnabled,
	updatePlugin,
	type PluginRegistryEntry,
	type PluginScope,
} from '@ottocode/sdk';
import { colors } from './ui.ts';

export type PluginCommandOptions = {
	project: string;
	scope?: PluginScope;
	registry?: string;
	json?: boolean;
};

export async function runPluginsList(
	opts: PluginCommandOptions,
): Promise<void> {
	const effective = await resolveEffectivePlugins(opts.project);
	const plugins = effective.plugins.map((plugin) => ({
		name: plugin.name,
		scope: plugin.scope,
		enabled: plugin.enabled,
		status: plugin.status,
		version: plugin.manifest?.version ?? plugin.configEntry?.version,
		source: plugin.configEntry?.source,
		description: plugin.manifest?.description,
		overriddenByProject: plugin.overriddenByProject ?? false,
		error: plugin.error,
	}));

	if (opts.json) {
		console.log(JSON.stringify(plugins, null, 2));
		return;
	}

	if (plugins.length === 0) {
		console.log(colors.dim('No plugins installed.'));
		return;
	}

	console.log('');
	console.log(colors.bold('Installed Plugins'));
	console.log('');
	for (const plugin of plugins) {
		const state = plugin.enabled
			? colors.green('enabled')
			: colors.dim('disabled');
		const version = plugin.version ? `@${plugin.version}` : '';
		console.log(
			`  ${colors.cyan(plugin.name)}${version} ${colors.dim(`[${plugin.scope}]`)} ${state}`,
		);
		if (plugin.description)
			console.log(`    ${colors.dim(plugin.description)}`);
		if (plugin.status !== 'installed') {
			console.log(
				`    ${colors.yellow(plugin.status)} ${colors.dim(plugin.error ?? '')}`,
			);
		}
	}
}

export async function runPluginsSearch(
	query: string | undefined,
	opts: PluginCommandOptions,
): Promise<void> {
	const registry = await fetchPluginRegistry({
		url: opts.registry ?? DEFAULT_PLUGIN_REGISTRY_URL,
	});
	const normalizedQuery = query?.trim().toLowerCase();
	const plugins = registry.plugins.filter((plugin) => {
		if (!normalizedQuery) return true;
		return [
			plugin.name,
			plugin.displayName,
			plugin.publisher,
			plugin.description,
			...(plugin.tags ?? []),
		]
			.filter(Boolean)
			.some((value) => value?.toLowerCase().includes(normalizedQuery));
	});

	if (opts.json) {
		console.log(JSON.stringify(plugins, null, 2));
		return;
	}

	if (plugins.length === 0) {
		console.log(colors.dim('No matching plugins found.'));
		return;
	}

	console.log('');
	console.log(colors.bold('Registry Plugins'));
	console.log('');
	for (const plugin of plugins) {
		printRegistryEntry(plugin);
	}
}

export async function runPluginsInfo(
	name: string,
	opts: PluginCommandOptions,
): Promise<void> {
	const { entry } = await resolveRegistryPlugin(name, {
		registries: [opts.registry ?? DEFAULT_PLUGIN_REGISTRY_URL],
	});

	if (opts.json) {
		console.log(JSON.stringify(entry, null, 2));
		return;
	}

	printRegistryEntry(entry);
	if (entry.source) {
		console.log(`  ${colors.dim(`source: ${entry.source.type}`)}`);
	}
}

export async function runPluginsInstall(
	source: string,
	opts: PluginCommandOptions,
): Promise<void> {
	const plugin = await installPlugin(source, {
		scope: opts.scope,
		projectRoot: opts.project,
		registries: [opts.registry ?? DEFAULT_PLUGIN_REGISTRY_URL],
	});
	if (opts.json) {
		console.log(JSON.stringify(plugin, null, 2));
		return;
	}
	console.log(colors.green(`Installed ${plugin.name} (${plugin.scope})`));
}

export async function runPluginsRemove(
	name: string,
	opts: PluginCommandOptions,
): Promise<void> {
	await removePlugin(name, { scope: opts.scope, projectRoot: opts.project });
	console.log(colors.green(`Removed ${name} (${opts.scope ?? 'global'})`));
}

export async function runPluginsSetEnabled(
	name: string,
	enabled: boolean,
	opts: PluginCommandOptions,
): Promise<void> {
	await setPluginEnabled(name, enabled, {
		scope: opts.scope,
		projectRoot: opts.project,
	});
	console.log(
		colors.green(
			`${enabled ? 'Enabled' : 'Disabled'} ${name} (${opts.scope ?? 'global'})`,
		),
	);
}

export async function runPluginsUpdate(
	name: string,
	opts: PluginCommandOptions,
): Promise<void> {
	const plugin = await updatePlugin(name, {
		scope: opts.scope,
		projectRoot: opts.project,
		registries: [opts.registry ?? DEFAULT_PLUGIN_REGISTRY_URL],
	});
	if (opts.json) {
		console.log(JSON.stringify(plugin, null, 2));
		return;
	}
	console.log(colors.green(`Updated ${plugin.name} (${plugin.scope})`));
}

function printRegistryEntry(plugin: PluginRegistryEntry): void {
	const official = plugin.official ? ` ${colors.green('official')}` : '';
	console.log(`  ${colors.cyan(plugin.name)}@${plugin.version}${official}`);
	if (plugin.description) console.log(`    ${colors.dim(plugin.description)}`);
	if (plugin.tags?.length)
		console.log(`    ${colors.dim(plugin.tags.join(', '))}`);
}
