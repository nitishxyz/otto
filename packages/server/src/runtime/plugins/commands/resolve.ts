import {
	pluginNameSchema,
	resolveEffectivePlugins,
	type PluginCommand,
} from '@ottocode/sdk';
import type { PluginCommandListEntry, ResolvedPluginCommand } from './types.ts';

const PLUGIN_COMMAND_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

function isEnabledInstalledPlugin(
	plugin: Awaited<
		ReturnType<typeof resolveEffectivePlugins>
	>['plugins'][number],
): boolean {
	return (
		plugin.enabled && plugin.status === 'installed' && Boolean(plugin.manifest)
	);
}

function findPluginCommandDefinition(
	commands: Record<string, PluginCommand>,
	commandName: string,
): { commandName: string; definition: PluginCommand } | null {
	const exact = commands[commandName];
	if (exact) return { commandName, definition: exact };

	const normalized = commandName.toLowerCase();
	for (const [name, definition] of Object.entries(commands)) {
		if (name.toLowerCase() === normalized) {
			return { commandName: name, definition };
		}
	}
	return null;
}

function findEffectivePlugin(
	plugins: Awaited<ReturnType<typeof resolveEffectivePlugins>>['plugins'],
	pluginName: string,
) {
	const exact = plugins.find((plugin) => plugin.name === pluginName);
	if (exact) return exact;

	const normalized = pluginName.toLowerCase();
	return plugins.find((plugin) => plugin.name.toLowerCase() === normalized);
}

export async function listPluginCommands(
	projectRoot: string,
): Promise<PluginCommandListEntry[]> {
	let effectivePlugins: Awaited<ReturnType<typeof resolveEffectivePlugins>>;
	try {
		effectivePlugins = await resolveEffectivePlugins(projectRoot);
	} catch {
		return [];
	}

	const entries: PluginCommandListEntry[] = [];
	for (const plugin of effectivePlugins.plugins) {
		if (!isEnabledInstalledPlugin(plugin)) continue;

		const commands = plugin.manifest?.commands;
		if (!commands) continue;

		for (const [commandName, definition] of Object.entries(commands).sort(
			(a, b) => a[0].localeCompare(b[0]),
		)) {
			if (!PLUGIN_COMMAND_NAME_PATTERN.test(commandName)) continue;
			entries.push({
				plugin: plugin.name,
				command: commandName,
				label: definition.label,
				description: definition.description,
				parameters: definition.parameters,
				allowExtraArgs: definition.allowExtraArgs,
				previewUrl: plugin.manifest?.browser?.previewUrl,
				scope: plugin.scope,
			});
		}
	}

	return entries.sort(
		(a, b) =>
			a.plugin.localeCompare(b.plugin) || a.command.localeCompare(b.command),
	);
}

export async function resolvePluginCommand(
	projectRoot: string,
	pluginName: string,
	commandName: string,
): Promise<ResolvedPluginCommand | null> {
	if (!pluginNameSchema.safeParse(pluginName).success) return null;
	if (!PLUGIN_COMMAND_NAME_PATTERN.test(commandName)) return null;

	let effectivePlugins: Awaited<ReturnType<typeof resolveEffectivePlugins>>;
	try {
		effectivePlugins = await resolveEffectivePlugins(projectRoot);
	} catch {
		return null;
	}

	const plugin = findEffectivePlugin(effectivePlugins.plugins, pluginName);
	if (!plugin || !isEnabledInstalledPlugin(plugin)) return null;

	const commands = plugin.manifest?.commands;
	if (!commands) return null;

	const resolved = findPluginCommandDefinition(commands, commandName);
	if (!resolved) return null;

	return {
		plugin,
		commandName: resolved.commandName,
		definition: resolved.definition,
		previewUrl: plugin.manifest?.browser?.previewUrl,
	};
}
