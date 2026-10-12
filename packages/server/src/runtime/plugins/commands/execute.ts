import type { TerminalManager } from '@ottocode/sdk';
import { APIError } from '../../errors/api-error.ts';
import { normalizePluginCommandRunInput } from './parse.ts';
import { renderPluginCommand } from './render.ts';
import { resolvePluginCommand } from './resolve.ts';
import type {
	RenderedPluginCommandSpec,
	PluginCommandRunResult,
} from './types.ts';

export type PluginCommandRunInput = {
	projectRoot: string;
	plugin: string;
	command: string;
	argsText?: string;
	args?: Record<string, string | number | boolean>;
	extraArgs?: string[];
};

export type PluginCommandTerminalBridge = {
	isAvailable(): boolean;
	start(input: {
		spec: RenderedPluginCommandSpec;
		title: string;
		purpose: string;
		projectRoot: string;
	}): { terminalId: string; command: string; title: string };
};

export function formatRenderedCommand(spec: RenderedPluginCommandSpec): string {
	const parts = [spec.command, ...(spec.args ?? [])].filter(Boolean);
	return parts.join(' ');
}

export function buildPluginCommandTitle(
	plugin: string,
	commandName: string,
	label?: string,
): string {
	return label?.trim() || `${plugin} ${commandName}`;
}

export function createServerTerminalBridge(
	terminalManager: TerminalManager | undefined,
): PluginCommandTerminalBridge {
	return {
		isAvailable() {
			return Boolean(terminalManager);
		},
		start({ spec, title, purpose, projectRoot }) {
			if (!terminalManager) {
				throw new APIError('Plugin command terminal execution is unavailable', {
					status: 503,
					code: 'plugin_command_terminal_unavailable',
					type: 'terminal_bridge_error',
				});
			}

			const terminal = terminalManager.create({
				command: spec.command,
				args: spec.args ?? [],
				cwd: spec.cwd ?? projectRoot,
				purpose,
				title,
				createdBy: 'user',
				env: spec.env,
			});

			return {
				terminalId: terminal.id,
				command: formatRenderedCommand(spec),
				title,
			};
		},
	};
}

/** Immutable, fully validated execution spec produced once per invocation. */
export type PreparedPluginCommand = Readonly<{
	projectRoot: string;
	plugin: string;
	commandName: string;
	title: string;
	purpose: string;
	primary: Readonly<RenderedPluginCommandSpec>;
	fallback?: Readonly<RenderedPluginCommandSpec>;
	command: string;
	fallbackCommand?: string;
	previewUrl?: string;
}>;

export type PreparePluginCommandResult =
	| { ok: true; prepared: PreparedPluginCommand }
	| {
			ok: false;
			error: string;
			code:
				| 'plugin_command_not_found'
				| 'plugin_command_invalid_args'
				| 'plugin_command_render_error';
			status: 400 | 404;
	  };

function freezeSpec(
	spec: RenderedPluginCommandSpec,
): Readonly<RenderedPluginCommandSpec> {
	return Object.freeze({
		command: spec.command,
		args: Object.freeze([...spec.args]) as string[],
		...(spec.env ? { env: Object.freeze({ ...spec.env }) } : {}),
		...(spec.cwd ? { cwd: spec.cwd } : {}),
	});
}

/**
 * Resolves, validates, and renders a plugin command exactly once. Execution
 * consumes the returned immutable spec, so what was validated (and shown for
 * approval) is what runs.
 */
export async function preparePluginCommand(
	input: PluginCommandRunInput,
): Promise<PreparePluginCommandResult> {
	const resolved = await resolvePluginCommand(
		input.projectRoot,
		input.plugin,
		input.command,
	);
	if (!resolved) {
		return {
			ok: false,
			error: `Plugin command not found: /${input.plugin} ${input.command}`,
			code: 'plugin_command_not_found',
			status: 404,
		};
	}

	const parsed = normalizePluginCommandRunInput(resolved.definition, {
		argsText: input.argsText,
		args: input.args,
		extraArgs: input.extraArgs,
	});
	if (!parsed.ok) {
		return {
			ok: false,
			error: parsed.error,
			code: 'plugin_command_invalid_args',
			status: 400,
		};
	}

	const rendered = renderPluginCommand(resolved.definition, parsed.values, {
		pluginDir: resolved.plugin.dir,
		extraArgs: parsed.extraArgs,
	});
	if (!rendered.ok) {
		return {
			ok: false,
			error: rendered.error,
			code: 'plugin_command_render_error',
			status: 400,
		};
	}

	const title = buildPluginCommandTitle(
		resolved.plugin.name,
		resolved.commandName,
		resolved.definition.label,
	);
	const primary = freezeSpec(rendered.primary);
	const fallback = rendered.fallback
		? freezeSpec(rendered.fallback)
		: undefined;
	return {
		ok: true,
		prepared: Object.freeze({
			projectRoot: input.projectRoot,
			plugin: resolved.plugin.name,
			commandName: resolved.commandName,
			title,
			purpose: title,
			primary,
			...(fallback
				? { fallback, fallbackCommand: formatRenderedCommand(fallback) }
				: {}),
			command: formatRenderedCommand(primary),
			...(resolved.previewUrl ? { previewUrl: resolved.previewUrl } : {}),
		}),
	};
}

/** Starts a prepared command in a visible terminal. */
export function executePreparedPluginCommand(
	prepared: PreparedPluginCommand,
	bridge: PluginCommandTerminalBridge,
): PluginCommandRunResult {
	if (!bridge.isAvailable()) {
		throw new APIError('Plugin command terminal execution is unavailable', {
			status: 503,
			code: 'plugin_command_terminal_unavailable',
			type: 'terminal_bridge_error',
			details: {
				command: prepared.command,
				title: prepared.title,
				previewUrl: prepared.previewUrl,
			},
		});
	}

	const started = bridge.start({
		// Hand the terminal layer a private copy: it may mutate its inputs,
		// while the prepared spec stays immutable.
		spec: {
			...prepared.primary,
			args: [...prepared.primary.args],
			...(prepared.primary.env ? { env: { ...prepared.primary.env } } : {}),
		},
		title: prepared.title,
		purpose: prepared.purpose,
		projectRoot: prepared.projectRoot,
	});

	return {
		command: started.command,
		terminalId: started.terminalId,
		title: started.title,
		...(prepared.previewUrl ? { previewUrl: prepared.previewUrl } : {}),
		execution: 'started',
	};
}

export async function runPluginCommand(
	input: PluginCommandRunInput,
	bridge: PluginCommandTerminalBridge,
): Promise<PluginCommandRunResult> {
	const prepared = await preparePluginCommand(input);
	if (!prepared.ok) {
		throw new APIError(prepared.error, {
			status: prepared.status,
			code: prepared.code,
		});
	}
	return executePreparedPluginCommand(prepared.prepared, bridge);
}
