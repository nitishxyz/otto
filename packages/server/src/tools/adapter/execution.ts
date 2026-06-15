import type { Tool } from 'ai';
import { shellExecutorContext, type ShellExecutor } from '@ottocode/sdk';
import { getShellExecutionConfig } from '@ottocode/sdk/tools/bin-manager';
import { appendTailLines } from '@ottocode/sdk/tools/builtin/shell';
import { createToolError, type ToolResponse } from '@ottocode/sdk/tools/error';
import { spawn } from 'node:child_process';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import { requestSecureInput } from '../../runtime/tools/secure-input.ts';
import {
	detectSecurePrompt,
	normalizeSudoCommand,
} from '../../runtime/tools/secure-prompt.ts';
import { attachTerminalSecureInput } from '../../runtime/tools/terminal-secure-input.ts';
import { registerActiveShellProcess } from '../../runtime/tools/active-shells.ts';
import { getCwd, joinRelative, setCwd } from '../../runtime/utils/cwd.ts';
import { publishToolDelta } from './events.ts';

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
type ShellResult = ToolResponse<{
	exitCode: number;
	stdout: string;
	stderr: string;
	outputMode?: 'full' | 'tail';
	tailLines?: number;
}>;
type SecureShellStreamChunk =
	| { channel: 'output'; delta: string }
	| { result: ShellResult };

const SHELL_OUTPUT_LIMIT_BYTES = 1024 * 1024;

function killProcessTree(pid: number) {
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {}
	}
}

function forceKillProcessTree(pid: number) {
	try {
		process.kill(-pid, 'SIGKILL');
	} catch {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {}
	}
}

function createSecureShellExecutor(args: {
	ctx: ToolAdapterContext;
	callId?: string;
}): ShellExecutor {
	const { ctx, callId } = args;
	return async function* secureShellExecutor(input, options) {
		const cmd = normalizeSudoCommand(input.cmd);
		const timeout = input.timeout ?? 300000;
		const outputMode = input.outputMode ?? 'full';
		const tailLines = input.tailLines ?? 100;
		const shellConfig = getShellExecutionConfig(cmd);
		const proc = spawn(shellConfig.command, shellConfig.args, {
			cwd: input.cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: shellConfig.env,
			detached: true,
		});
		let stdout = '';
		let stderr = '';
		let recentOutput = '';
		let securePromptPending = false;
		let didTimeout = false;
		let didAbort = false;
		let settled = false;
		let terminating = false;
		let done = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let killEscalationId: ReturnType<typeof setTimeout> | null = null;
		let fallbackSettleId: ReturnType<typeof setTimeout> | null = null;
		let unregisterActiveShell: () => void = () => {};
		const queue: SecureShellStreamChunk[] = [];
		let notify: (() => void) | null = null;

		const wake = () => {
			if (!notify) return;
			notify();
			notify = null;
		};

		const pushDelta = (text: string) => {
			if (!text) return;
			queue.push({ channel: 'output', delta: text });
			wake();
		};

		const settle = (result: ShellResult) => {
			if (settled) return;
			settled = true;
			if (timeoutId) clearTimeout(timeoutId);
			if (killEscalationId) clearTimeout(killEscalationId);
			if (fallbackSettleId) clearTimeout(fallbackSettleId);
			unregisterActiveShell();
			options?.abortSignal?.removeEventListener('abort', onAbort);
			queue.push({ result });
			done = true;
			wake();
		};

		const abortResult = () =>
			createToolError(`Command aborted by user: ${input.cmd}`, 'abort', {
				cmd: input.cmd,
				stdout,
				stderr,
				...(outputMode === 'tail' ? { outputMode, tailLines } : {}),
			});

		const timeoutResult = () =>
			createToolError(
				`Command timed out after ${timeout}ms: ${input.cmd}`,
				'timeout',
				{
					parameter: 'timeout',
					value: timeout,
					stdout,
					stderr,
					...(outputMode === 'tail' ? { outputMode, tailLines } : {}),
					suggestion: 'Increase timeout or optimize the command',
				},
			);

		const terminate = (fallbackResult: () => ShellResult) => {
			if (terminating) return;
			terminating = true;
			if (proc.pid) {
				killProcessTree(proc.pid);
				killEscalationId = setTimeout(() => {
					if (proc.pid) forceKillProcessTree(proc.pid);
				}, 1000);
			} else {
				proc.kill('SIGTERM');
			}
			proc.stdin?.destroy();
			fallbackSettleId = setTimeout(() => {
				settle(fallbackResult());
			}, 2000);
		};

		unregisterActiveShell = registerActiveShellProcess({
			sessionId: ctx.sessionId,
			messageId: ctx.messageId,
			callId,
			abort: () => {
				if (settled) return;
				didAbort = true;
				terminate(abortResult);
			},
		});

		const maybeRequestSecureInput = (text: string) => {
			recentOutput = `${recentOutput}${text}`.slice(-1000);
			if (securePromptPending) return;
			const prompt = detectSecurePrompt(recentOutput);
			if (!prompt) return;

			securePromptPending = true;
			void requestSecureInput({
				sessionId: ctx.sessionId,
				messageId: ctx.messageId,
				callId,
				prompt,
			}).then((value) => {
				securePromptPending = false;
				recentOutput = '';
				if (settled) return;
				if (value === null) {
					didAbort = true;
					terminate(abortResult);
					return;
				}
				proc.stdin?.write(`${value}\n`);
			});
		};

		function onAbort() {
			if (settled) return;
			didAbort = true;
			terminate(abortResult);
		}

		options?.abortSignal?.addEventListener('abort', onAbort, { once: true });

		if (timeout > 0) {
			timeoutId = setTimeout(() => {
				didTimeout = true;
				terminate(timeoutResult);
			}, timeout);
		}

		proc.stdout?.on('data', (chunk) => {
			const text = chunk.toString();
			stdout =
				outputMode === 'tail'
					? appendTailLines(stdout, text, tailLines)
					: `${stdout}${text}`;
			if (outputMode === 'full' && stdout.length > SHELL_OUTPUT_LIMIT_BYTES) {
				stdout = stdout.slice(-SHELL_OUTPUT_LIMIT_BYTES);
			}
			pushDelta(text);
			maybeRequestSecureInput(text);
		});

		proc.stderr?.on('data', (chunk) => {
			const text = chunk.toString();
			stderr =
				outputMode === 'tail'
					? appendTailLines(stderr, text, tailLines)
					: `${stderr}${text}`;
			if (outputMode === 'full' && stderr.length > SHELL_OUTPUT_LIMIT_BYTES) {
				stderr = stderr.slice(-SHELL_OUTPUT_LIMIT_BYTES);
			}
			pushDelta(text);
			maybeRequestSecureInput(text);
		});

		proc.on('close', (exitCode) => {
			if (didAbort) {
				settle(abortResult());
				return;
			}

			if (didTimeout) {
				settle(timeoutResult());
				return;
			}

			if (exitCode !== 0 && !input.allowNonZeroExit) {
				const errorDetail = stderr.trim() || stdout.trim() || '';
				const errorMsg = `Command failed with exit code ${exitCode}${errorDetail ? `\n\n${errorDetail}` : ''}`;
				settle(
					createToolError(errorMsg, 'execution', {
						exitCode,
						stdout,
						stderr,
						cmd: input.cmd,
						...(outputMode === 'tail' ? { outputMode, tailLines } : {}),
						suggestion: 'Check command syntax or use allowNonZeroExit: true',
					}),
				);
				return;
			}

			settle({
				ok: true,
				exitCode: exitCode ?? 0,
				stdout,
				stderr,
				...(outputMode === 'tail' ? { outputMode, tailLines } : {}),
			});
		});

		proc.on('error', (err) => {
			settle(
				createToolError(
					`Command execution failed: ${err.message}`,
					'execution',
					{
						cmd: input.cmd,
						originalError: err.message,
					},
				),
			);
		});

		while (!done || queue.length > 0) {
			if (queue.length === 0) {
				await new Promise<void>((resolve) => {
					notify = resolve;
				});
			}
			while (queue.length > 0) {
				const chunk = queue.shift();
				if (chunk) yield chunk;
			}
		}
	};
}
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

function getStringDelta(chunk: unknown): string | null {
	if (typeof chunk === 'string') return chunk;
	if (
		chunk &&
		typeof chunk === 'object' &&
		'delta' in chunk &&
		typeof (chunk as { delta?: unknown }).delta === 'string'
	) {
		return (chunk as { delta: string }).delta ?? '';
	}
	return null;
}

function getStringChannel(chunk: unknown): string {
	if (
		chunk &&
		typeof chunk === 'object' &&
		'channel' in chunk &&
		typeof (chunk as { channel?: unknown }).channel === 'string'
	) {
		return (chunk as { channel: string }).channel ?? 'output';
	}
	return 'output';
}

function getTerminalId(chunk: unknown): string | null {
	if (
		chunk &&
		typeof chunk === 'object' &&
		'terminalId' in chunk &&
		typeof (chunk as { terminalId?: unknown }).terminalId === 'string'
	) {
		return (chunk as { terminalId: string }).terminalId;
	}
	return null;
}

export async function consumeToolStream(
	ctx: ToolAdapterContext,
	args: {
		stream: AsyncIterable<unknown>;
		name: string;
		stepIndex?: number;
		callId?: string;
	},
): Promise<unknown> {
	const chunks: unknown[] = [];
	let streamedResult: unknown = null;

	for await (const chunk of args.stream) {
		chunks.push(chunk);
		if (chunk && typeof chunk === 'object' && 'result' in chunk) {
			streamedResult = (chunk as { result: unknown }).result;
			continue;
		}

		const terminalId = getTerminalId(chunk);
		if (terminalId) {
			publishToolDelta(ctx, {
				name: args.name,
				channel: 'terminal',
				delta: terminalId,
				stepIndex: args.stepIndex,
				callId: args.callId,
			});
			continue;
		}

		const delta = getStringDelta(chunk);
		if (!delta) continue;

		publishToolDelta(ctx, {
			name: args.name,
			channel: getStringChannel(chunk),
			delta,
			stepIndex: args.stepIndex,
			callId: args.callId,
		});
	}

	return (
		streamedResult ?? (chunks.length > 0 ? chunks[chunks.length - 1] : null)
	);
}
