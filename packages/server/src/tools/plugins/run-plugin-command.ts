import { tool, type Tool } from 'ai';
import { z } from 'zod/v3';
import { getTerminalManager } from '@ottocode/sdk';
import { APIError } from '../../runtime/errors/api-error.ts';
import {
	createServerTerminalBridge,
	formatRenderedCommand,
	normalizePluginCommandRunInput,
	renderPluginCommand,
	resolvePluginCommand,
	runPluginCommand,
} from '../../runtime/plugins/commands/index.ts';

const inputSchema = z.object({
	plugin: z.string().min(1).describe('Enabled plugin namespace name.'),
	command: z.string().min(1).describe('Plugin command name.'),
	args: z
		.record(z.union([z.string(), z.number(), z.boolean()]))
		.optional()
		.describe('Parsed command arguments as key/value pairs.'),
	argsText: z
		.string()
		.optional()
		.describe('Raw args text, e.g. "--port 3200".'),
	extraArgs: z
		.array(z.string())
		.optional()
		.describe('Extra args when the command allows unknown flags.'),
});

export function buildRunPluginCommandTool(projectRoot: string): {
	name: string;
	tool: Tool;
} {
	return {
		name: 'run_plugin_command',
		tool: tool({
			description:
				'Run an enabled installed plugin command in a visible terminal. Only use for plugins that are currently enabled. Requires normal tool approval. Load this tool with `load_tools` before calling.',
			inputSchema,
			execute: async (input) => {
				const bridge = createServerTerminalBridge(getTerminalManager());
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

				const rendered = renderPluginCommand(
					resolved.definition,
					parsed.values,
					{
						pluginDir: resolved.plugin.dir,
						extraArgs: parsed.extraArgs,
					},
				);
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
			},
		}),
	};
}
