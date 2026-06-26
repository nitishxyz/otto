import type { TerminalManager } from '@ottocode/sdk';
import { isInitCommand } from './init.ts';
import { isCompactCommand } from '../message/compaction.ts';
import { prepareRecipeCommand } from './recipes.ts';
import { parsePluginCommandInvocation } from '../plugins/commands/parse.ts';
import {
	createServerTerminalBridge,
	runPluginCommand,
	type PluginCommandTerminalBridge,
} from '../plugins/commands/execute.ts';
import type { PluginCommandRunResult } from '../plugins/commands/types.ts';

/**
 * Executes plugin slash commands when they win slash precedence:
 * built-in agent commands and recipes take priority over plugin namespaces.
 */
export async function tryExecutePluginSlashMessage(args: {
	projectRoot: string;
	content: string;
	terminalManager?: TerminalManager;
	bridge?: PluginCommandTerminalBridge;
}): Promise<PluginCommandRunResult | null> {
	const bridge =
		args.bridge ?? createServerTerminalBridge(args.terminalManager);

	if (isCompactCommand(args.content) || isInitCommand(args.content)) {
		return null;
	}

	const recipe = await prepareRecipeCommand({
		projectRoot: args.projectRoot,
		content: args.content,
	});
	if (recipe) return null;

	const invocation = parsePluginCommandInvocation(args.content);
	if (!invocation) return null;

	return runPluginCommand(
		{
			projectRoot: args.projectRoot,
			plugin: invocation.plugin,
			command: invocation.command,
			argsText: invocation.argsText,
		},
		bridge,
	);
}
