import type { ShellExecutor } from '@ottocode/sdk';
import { getShellExecutionConfig } from '@ottocode/sdk/tools/bin-manager';
import {
	appendTailLines,
	detectShellEnvHint,
} from '@ottocode/sdk/tools/builtin/shell';
import { createToolError, type ToolResponse } from '@ottocode/sdk/tools/error';
import { spawn } from 'node:child_process';
import type { ToolAdapterContext } from '../../runtime/tools/context.ts';
import {
	registerActiveShellProcess,
	type ActiveShellRegistration,
} from '../../runtime/tools/active-shells.ts';
import {
	invalidateCachedSecureInput,
	requestSecureInput,
} from '../../runtime/tools/secure-input.ts';
import {
	detectSecurePrompt,
	hasAuthenticationFailure,
	normalizeSudoCommand,
} from '../../runtime/tools/secure-prompt.ts';

type ShellResult = ToolResponse<{
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	detached?: boolean;
	jobId?: string;
	status?: 'running';
	outputMode?: 'full' | 'tail';
	tailLines?: number;
	envMode?: 'minimal' | 'login-cache' | 'login-fresh';
	envHint?: string;
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

export function createSecureShellExecutor(args: {
	ctx: ToolAdapterContext;
	callId?: string;
}): ShellExecutor {
	const { ctx, callId } = args;
	return async function* secureShellExecutor(input, options) {
		const cmd = normalizeSudoCommand(input.cmd);
		const timeout = input.timeout ?? 300000;
		const outputMode = input.outputMode ?? 'full';
		const tailLines = input.tailLines ?? 100;
		const envMode = input.envMode ?? 'login-cache';
		const shellConfig = getShellExecutionConfig(cmd, { envMode });
		const proc = spawn(shellConfig.command, shellConfig.args, {
			cwd: input.cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: shellConfig.env,
			detached: true,
		});
		let stdout = '';
		let stderr = '';
		let recentOutput = '';
		let lastSecureInputCacheKey: string | null = null;
		let securePromptPending = false;
		let didTimeout = false;
		let didAbort = false;
		let processSettled = false;
		let streamSettled = false;
		let detached = false;
		let terminating = false;
		let done = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let killEscalationId: ReturnType<typeof setTimeout> | null = null;
		let fallbackSettleId: ReturnType<typeof setTimeout> | null = null;
		let activeShell: ActiveShellRegistration | null = null;
		const queue: SecureShellStreamChunk[] = [];
		let notify: (() => void) | null = null;

		const wake = () => {
			if (!notify) return;
			notify();
			notify = null;
		};

		const pushDelta = (text: string) => {
			if (!text || streamSettled) return;
			queue.push({ channel: 'output', delta: text });
			wake();
		};

		const settle = (result: ShellResult) => {
			if (processSettled) return;
			processSettled = true;
			if (timeoutId) clearTimeout(timeoutId);
			if (killEscalationId) clearTimeout(killEscalationId);
			if (fallbackSettleId) clearTimeout(fallbackSettleId);
			options?.abortSignal?.removeEventListener('abort', onAbort);
			const resultRecord = result as Record<string, unknown>;
			const details =
				resultRecord.details && typeof resultRecord.details === 'object'
					? (resultRecord.details as Record<string, unknown>)
					: undefined;
			const exitCode =
				typeof resultRecord.exitCode === 'number'
					? resultRecord.exitCode
					: typeof details?.exitCode === 'number'
						? details.exitCode
						: null;
			const status =
				resultRecord.ok === false
					? resultRecord.errorType === 'abort'
						? 'cancelled'
						: 'failed'
					: 'completed';
			activeShell?.complete({ status, result, exitCode });
			if (!streamSettled) {
				streamSettled = true;
				queue.push({ result });
				done = true;
				wake();
			}
		};

		const detachStream = (jobId: string) => {
			if (streamSettled || processSettled) return;
			detached = true;
			streamSettled = true;
			options?.abortSignal?.removeEventListener('abort', onAbort);
			queue.push({
				result: {
					ok: true,
					detached: true,
					jobId,
					status: 'running',
					stdout,
					stderr,
					envMode,
				},
			});
			done = true;
			wake();
		};

		const abortResult = () =>
			createToolError(`Command aborted by user: ${input.cmd}`, 'abort', {
				cmd: input.cmd,
				stdout,
				stderr,
				envMode,
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
					envMode,
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

		activeShell = registerActiveShellProcess({
			projectRoot: ctx.projectRoot,
			sessionId: ctx.sessionId,
			messageId: ctx.messageId,
			callId,
			command: input.cmd,
			cwd: input.cwd,
			abort: () => {
				if (processSettled) return;
				didAbort = true;
				terminate(abortResult);
			},
			onDetach: detachStream,
			onDetachedCompletion: (sessionId, projectRoot) => {
				void import('../../runtime/shell-jobs/report.ts').then(
					({ reportFinishedShellJobsWhenIdle }) =>
						reportFinishedShellJobsWhenIdle(sessionId, projectRoot),
				);
			},
		});
		if (input.detached) activeShell.detach();

		const maybeRequestSecureInput = (text: string) => {
			recentOutput = `${recentOutput}${text}`.slice(-1000);
			if (securePromptPending) return;
			const detected = detectSecurePrompt(recentOutput);
			if (!detected) return;

			securePromptPending = true;
			const cacheKey = `shell:${input.cmd}\n${detected.prompt}`;
			lastSecureInputCacheKey = cacheKey;
			void requestSecureInput({
				projectRoot: ctx.projectRoot,
				sessionId: ctx.sessionId,
				messageId: ctx.messageId,
				callId,
				prompt: detected.prompt,
				inputKind: detected.inputKind,
				allowEmpty: detected.allowEmpty,
				cacheKey,
				bypassCache: hasAuthenticationFailure(recentOutput),
			}).then((value) => {
				securePromptPending = false;
				recentOutput = '';
				if (processSettled) return;
				if (value === null) {
					didAbort = true;
					terminate(abortResult);
					return;
				}
				proc.stdin?.write(`${value}\n`);
			});
		};

		function onAbort() {
			if (processSettled || detached) return;
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
			activeShell?.appendOutput(text);
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
			activeShell?.appendOutput(text);
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
			const resolvedExitCode = exitCode ?? 0;
			if (
				lastSecureInputCacheKey &&
				hasAuthenticationFailure(`${stdout}\n${stderr}`)
			) {
				invalidateCachedSecureInput(ctx.projectRoot, lastSecureInputCacheKey);
			}
			const envHint = detectShellEnvHint({
				stdout,
				stderr,
				exitCode: resolvedExitCode,
				envMode,
			});
			if (didAbort) {
				settle(abortResult());
				return;
			}

			if (didTimeout) {
				settle(timeoutResult());
				return;
			}

			if (resolvedExitCode !== 0 && !input.allowNonZeroExit) {
				const errorDetail = stderr.trim() || stdout.trim() || '';
				const errorMsg = `Command failed with exit code ${resolvedExitCode}${errorDetail ? `\n\n${errorDetail}` : ''}`;
				settle(
					createToolError(errorMsg, 'execution', {
						exitCode: resolvedExitCode,
						stdout,
						stderr,
						cmd: input.cmd,
						envMode,
						...(envHint ? { envHint } : {}),
						...(outputMode === 'tail' ? { outputMode, tailLines } : {}),
						suggestion: 'Check command syntax or use allowNonZeroExit: true',
					}),
				);
				return;
			}

			settle({
				ok: true,
				exitCode: resolvedExitCode,
				stdout,
				stderr,
				envMode,
				...(envHint ? { envHint } : {}),
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
