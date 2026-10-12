import type { Tool } from 'ai';
import { shellExecutorContext } from '@ottocode/sdk';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import { attachTerminalSecureInput } from '../../runtime/tools/terminal-secure-input.ts';
import { getCwd, setCwd } from '../../runtime/utils/cwd.ts';
import { createSecureShellExecutor } from './secure-shell.ts';
import { getTerminalId } from './stream.ts';

type ToolExecuteSignature = Tool['execute'] extends (
	input: infer Input,
	options: infer Options,
) => infer Result
	? { input: Input; options: Options; result: Result }
	: { input: unknown; options: unknown; result: unknown };

type ToolExecuteInput = ToolExecuteSignature['input'];
type ToolExecuteOptions = ToolExecuteSignature['options'] extends never
	? undefined
	: ToolExecuteSignature['options'];
type ToolExecuteReturn = ToolExecuteSignature['result'];

/**
 * Runs the underlying tool. `input` must already be resolved by
 * `prepareToolCall`: path fields are project-relative or absolute and do
 * not depend on the session cwd.
 */
export function executeBaseTool(
	ctx: ToolAdapterContext,
	args: {
		base: Tool;
		name: string;
		input: ToolExecuteInput;
		options: ToolExecuteOptions;
		callId?: string;
	},
): ToolExecuteReturn | { cwd: string } | null | undefined {
	const cwd = getCwd(ctx.sessionId);
	const { base, name, input, options, callId } = args;

	if (name === 'pwd') {
		return { cwd };
	}

	if (name === 'cd') {
		const path = (input as Record<string, unknown> | undefined)?.path;
		if (typeof path !== 'string' || !path) return { cwd };
		const next = path;
		setCwd(ctx.sessionId, next);
		return { cwd: next };
	}

	if (name === 'shell' || name === 'bash') {
		const secureShellExecutor = createSecureShellExecutor({ ctx, callId });
		return shellExecutorContext.run(secureShellExecutor, () => {
			// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
			return base.execute?.(input, options as any);
		}) as ToolExecuteReturn;
	}

	if (name === 'terminal') {
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
		const res = base.execute?.(input, options as any);
		return Promise.resolve(res as ToolExecuteReturn).then(async (result) => {
			const terminalId = getTerminalId(result);
			if (terminalId) {
				const operation = (input as Record<string, unknown>)?.operation;
				const watcher = attachTerminalSecureInput({ ctx, terminalId, callId });
				const resolvedPrompt = await watcher?.waitForPromptResolution(
					operation === 'read' ? 0 : undefined,
				);
				if (resolvedPrompt && operation === 'read') {
					// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
					return Promise.resolve(base.execute?.(input, options as any));
				}
			}
			return result;
		}) as ToolExecuteReturn;
	}

	// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
	return base.execute?.(input, options as any);
}
