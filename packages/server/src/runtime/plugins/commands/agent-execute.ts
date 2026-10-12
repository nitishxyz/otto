import { getTerminalManager } from '@ottocode/sdk';
import { APIError } from '../../errors/api-error.ts';
import { getProjectManager } from '../../projects/manager.ts';
import {
	createServerTerminalBridge,
	executePreparedPluginCommand,
	preparePluginCommand,
} from './execute.ts';

export type AgentPluginCommandInput = {
	plugin: string;
	command: string;
	args?: Record<string, string | number | boolean>;
	argsText?: string;
	extraArgs?: string[];
};

const FALLBACK_POLICY = 'Automatic fallback execution is not supported yet.';

export async function executePluginCommandForAgent(
	projectRoot: string,
	input: AgentPluginCommandInput,
) {
	const terminalManager =
		getTerminalManager(projectRoot) ??
		(await getProjectManager().getProject({ path: projectRoot }))
			.terminalManager;
	const bridge = createServerTerminalBridge(terminalManager);
	const result = await preparePluginCommand({
		projectRoot,
		plugin: input.plugin,
		command: input.command,
		argsText: input.argsText,
		args: input.args,
		extraArgs: input.extraArgs,
	});
	if (!result.ok) {
		return {
			ok: false,
			error:
				result.code === 'plugin_command_not_found'
					? `Plugin command not found or plugin disabled: /${input.plugin} ${input.command}`
					: result.error,
			code: result.code,
		};
	}
	const { prepared } = result;
	const renderedCommand = prepared.command;
	const fallback = prepared.fallbackCommand
		? {
				fallbackCommand: prepared.fallbackCommand,
				fallbackPolicy: FALLBACK_POLICY,
			}
		: {};

	if (!bridge.isAvailable()) {
		return {
			ok: false,
			error: 'Plugin command terminal execution is unavailable',
			code: 'plugin_command_terminal_unavailable',
			renderedCommand,
			...fallback,
		};
	}

	try {
		const started = executePreparedPluginCommand(prepared, bridge);
		return {
			ok: true,
			renderedCommand: started.command,
			terminalId: started.terminalId,
			title: started.title,
			...(started.previewUrl ? { previewUrl: started.previewUrl } : {}),
			execution: started.execution,
			...fallback,
		};
	} catch (error) {
		if (error instanceof APIError) {
			return {
				ok: false,
				error: error.message,
				code: error.code,
				renderedCommand,
				...(error.details ?? {}),
				...(prepared.fallbackCommand
					? { fallbackCommand: prepared.fallbackCommand }
					: {}),
			};
		}
		throw error;
	}
}
