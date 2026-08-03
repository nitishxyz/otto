import { getTerminalManager } from '@ottocode/sdk';
import { APIError } from '../../errors/api-error.ts';
import { getProjectManager } from '../../projects/manager.ts';
import {
	createServerTerminalBridge,
	formatRenderedCommand,
	runPluginCommand,
} from './execute.ts';
import { normalizePluginCommandRunInput } from './parse.ts';
import { renderPluginCommand } from './render.ts';
import { resolvePluginCommand } from './resolve.ts';

export type AgentPluginCommandInput = {
	plugin: string;
	command: string;
	args?: Record<string, string | number | boolean>;
	argsText?: string;
	extraArgs?: string[];
};

export async function executePluginCommandForAgent(
	projectRoot: string,
	input: AgentPluginCommandInput,
) {
	const terminalManager =
		getTerminalManager(projectRoot) ??
		(await getProjectManager().getProject({ path: projectRoot }))
			.terminalManager;
	const bridge = createServerTerminalBridge(terminalManager);
	const resolved = await resolvePluginCommand(
		projectRoot,
		input.plugin,
		input.command,
	);
	if (!resolved) {
		return {
			ok: false,
			error: `Plugin command not found or plugin disabled: /${input.plugin} ${input.command}`,
			code: 'plugin_command_not_found',
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
		};
	}

	const renderedCommand = formatRenderedCommand(rendered.primary);
	const fallbackCommand = rendered.fallback
		? formatRenderedCommand(rendered.fallback)
		: undefined;

	if (!bridge.isAvailable()) {
		return {
			ok: false,
			error: 'Plugin command terminal execution is unavailable',
			code: 'plugin_command_terminal_unavailable',
			renderedCommand,
			...(fallbackCommand
				? {
						fallbackCommand,
						fallbackPolicy:
							'Automatic fallback execution is not supported yet.',
					}
				: {}),
		};
	}

	try {
		const result = await runPluginCommand(
			{
				projectRoot,
				plugin: input.plugin,
				command: input.command,
				argsText: input.argsText,
				args: input.args,
				extraArgs: input.extraArgs,
			},
			bridge,
		);
		return {
			ok: true,
			renderedCommand: result.command,
			terminalId: result.terminalId,
			title: result.title,
			...(result.previewUrl ? { previewUrl: result.previewUrl } : {}),
			execution: result.execution,
			...(fallbackCommand
				? {
						fallbackCommand,
						fallbackPolicy:
							'Automatic fallback execution is not supported yet.',
					}
				: {}),
		};
	} catch (error) {
		if (error instanceof APIError) {
			return {
				ok: false,
				error: error.message,
				code: error.code,
				renderedCommand,
				...(error.details ?? {}),
				...(fallbackCommand ? { fallbackCommand } : {}),
			};
		}
		throw error;
	}
}
