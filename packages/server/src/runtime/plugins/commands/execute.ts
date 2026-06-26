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

export async function runPluginCommand(
	input: PluginCommandRunInput,
	bridge: PluginCommandTerminalBridge,
): Promise<PluginCommandRunResult> {
	const resolved = await resolvePluginCommand(
		input.projectRoot,
		input.plugin,
		input.command,
	);
	if (!resolved) {
		throw new APIError(
			`Plugin command not found: /${input.plugin} ${input.command}`,
			{
				status: 404,
				code: 'plugin_command_not_found',
			},
		);
	}

	const parsed = normalizePluginCommandRunInput(resolved.definition, {
		argsText: input.argsText,
		args: input.args,
		extraArgs: input.extraArgs,
	});
	if (!parsed.ok) {
		throw new APIError(parsed.error, {
			status: 400,
			code: 'plugin_command_invalid_args',
		});
	}

	const rendered = renderPluginCommand(resolved.definition, parsed.values, {
		pluginDir: resolved.plugin.dir,
		extraArgs: parsed.extraArgs,
	});
	if (!rendered.ok) {
		throw new APIError(rendered.error, {
			status: 400,
			code: 'plugin_command_render_error',
		});
	}

	const title = buildPluginCommandTitle(
		resolved.plugin.name,
		resolved.commandName,
		resolved.definition.label,
	);
	const purpose = title;
	const command = formatRenderedCommand(rendered.primary);

	if (!bridge.isAvailable()) {
		throw new APIError('Plugin command terminal execution is unavailable', {
			status: 503,
			code: 'plugin_command_terminal_unavailable',
			type: 'terminal_bridge_error',
			details: {
				command,
				title,
				previewUrl: resolved.previewUrl,
			},
		});
	}

	const started = bridge.start({
		spec: rendered.primary,
		title,
		purpose,
		projectRoot: input.projectRoot,
	});

	return {
		command: started.command,
		terminalId: started.terminalId,
		title: started.title,
		...(resolved.previewUrl ? { previewUrl: resolved.previewUrl } : {}),
		execution: 'started',
	};
}
