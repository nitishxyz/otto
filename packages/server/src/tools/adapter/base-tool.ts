import type { Tool } from 'ai';
import { shellExecutorContext } from '@ottocode/sdk';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import { attachTerminalSecureInput } from '../../runtime/tools/terminal-secure-input.ts';
import { getCwd, joinRelative, setCwd } from '../../runtime/utils/cwd.ts';
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
		const next = joinRelative(
			cwd,
			String((input as Record<string, unknown>)?.path ?? '.'),
		);
		setCwd(ctx.sessionId, next);
		return { cwd: next };
	}

	if (
		['read', 'write', 'ls', 'tree'].includes(name) &&
		typeof (input as Record<string, unknown>)?.path === 'string'
	) {
		const rel = joinRelative(
			cwd,
			String((input as Record<string, unknown>).path),
		);
		const nextInput = {
			...(input as Record<string, unknown>),
			path: rel,
		} as ToolExecuteInput;
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
		return base.execute?.(nextInput, options as any);
	}

	if (name === 'shell' || name === 'bash') {
		const needsCwd =
			!input || typeof (input as Record<string, unknown>).cwd !== 'string';
		const nextInput = needsCwd
			? ({
					...(input as Record<string, unknown>),
					cwd,
				} as ToolExecuteInput)
			: input;
		const secureShellExecutor = createSecureShellExecutor({ ctx, callId });
		return shellExecutorContext.run(secureShellExecutor, () => {
			// biome-ignore lint/suspicious/noExplicitAny: AI SDK types are complex
			return base.execute?.(nextInput, options as any);
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
