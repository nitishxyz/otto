import { pluginManifestSchema, type PluginCommand } from '@ottocode/sdk';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import type {
	ForgeInput,
	ForgeMutation,
	ForgePlan,
	ForgeScope,
} from './types.ts';
import { assertForgePluginMutable, resolveForgePlugin } from './plugin.ts';

const COMMAND_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

function commandIdentity(input: ForgeInput): {
	plugin: string;
	commandName: string;
} {
	const plugin = input.plugin?.trim().toLowerCase();
	const commandName = (input.commandName ?? input.name)?.trim();
	if (!plugin) throw new Error('plugin is required for plugin-command actions');
	if (!commandName) {
		throw new Error('commandName is required for plugin-command actions');
	}
	if (!COMMAND_NAME_PATTERN.test(commandName)) {
		throw new Error(
			'Invalid plugin command name. Use letters, numbers, dots, underscores, or hyphens.',
		);
	}
	return { plugin, commandName };
}

function mutationAction(input: ForgeInput): ForgeMutation {
	if (input.action === 'plan') {
		if (!input.targetAction)
			throw new Error('targetAction is required for plan');
		return input.targetAction;
	}
	if (
		input.action === 'create' ||
		input.action === 'update' ||
		input.action === 'remove'
	) {
		return input.action;
	}
	throw new Error(
		`Action '${input.action}' is not supported for plugin-command mutation`,
	);
}

function buildCommand(
	input: ForgeInput,
	existing?: PluginCommand,
): PluginCommand {
	const command = input.command?.trim() || existing?.command;
	if (!command) throw new Error('command is required for a plugin command');
	return {
		command,
		...(input.label !== undefined || existing?.label !== undefined
			? { label: input.label ?? existing?.label }
			: {}),
		...(input.description !== undefined || existing?.description !== undefined
			? { description: input.description ?? existing?.description }
			: {}),
		...(input.args !== undefined || existing?.args !== undefined
			? { args: input.args ?? existing?.args }
			: {}),
		...(input.env !== undefined || existing?.env !== undefined
			? { env: input.env ?? existing?.env }
			: {}),
		...(input.cwd !== undefined || existing?.cwd !== undefined
			? { cwd: input.cwd ?? existing?.cwd }
			: {}),
		...(input.parameters !== undefined || existing?.parameters !== undefined
			? { parameters: input.parameters ?? existing?.parameters }
			: {}),
		...(input.allowExtraArgs !== undefined ||
		existing?.allowExtraArgs !== undefined
			? {
					allowExtraArgs: input.allowExtraArgs ?? existing?.allowExtraArgs,
				}
			: {}),
		...(existing?.fallback ? { fallback: existing.fallback } : {}),
	};
}

async function atomicWriteManifest(
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

export async function runForgePluginCommandAction(
	projectRoot: string,
	input: ForgeInput,
) {
	const { plugin: pluginName, commandName } = commandIdentity(input);
	const action = mutationAction(input);
	const plugin = await resolveForgePlugin(projectRoot, pluginName, input.scope);
	if (!plugin.manifest) throw new Error(`Plugin '${pluginName}' is invalid`);
	assertForgePluginMutable(plugin);
	const rawManifest = JSON.parse(
		await readFile(plugin.manifestPath, 'utf8'),
	) as Record<string, unknown>;
	const manifest = pluginManifestSchema.parse(rawManifest);
	const existing = manifest.commands?.[commandName];

	if (action === 'create' && existing) {
		throw new Error(
			`Plugin command '/${pluginName} ${commandName}' already exists; use update`,
		);
	}
	if ((action === 'update' || action === 'remove') && !existing) {
		throw new Error(`Plugin command '/${pluginName} ${commandName}' not found`);
	}

	const commands = { ...(manifest.commands ?? {}) };
	if (action === 'remove') delete commands[commandName];
	else commands[commandName] = buildCommand(input, existing);
	const nextManifest: Record<string, unknown> = { ...rawManifest };
	if (Object.keys(commands).length > 0) nextManifest.commands = commands;
	else delete nextManifest.commands;
	pluginManifestSchema.parse(nextManifest);
	const previewCommand = commands[commandName]
		? {
				...commands[commandName],
				...(commands[commandName].env
					? {
							env: Object.fromEntries(
								Object.keys(commands[commandName].env).map((key) => [
									key,
									'<redacted>',
								]),
							),
						}
					: {}),
			}
		: undefined;
	const scope = plugin.scope as ForgeScope;
	const plan: ForgePlan = {
		action,
		target: {
			kind: 'plugin-command',
			scope,
			name: `${pluginName}/${commandName}`,
			paths: [plugin.manifestPath],
		},
		exists: Boolean(existing),
		changes: [
			`${action} terminal slash command '/${pluginName} ${commandName}'`,
		],
		...(action === 'remove'
			? {}
			: { preview: JSON.stringify(previewCommand, null, 2) }),
	};

	if (input.action === 'plan' || input.dryRun) {
		return { ok: true, applied: false, plan };
	}
	await atomicWriteManifest(plugin.manifestPath, nextManifest);
	return {
		ok: true,
		applied: true,
		plan,
		command: action === 'remove' ? undefined : commands[commandName],
		slashCommand: `/${pluginName} ${commandName}`,
	};
}
