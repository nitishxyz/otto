import { getTerminalManager, type ShellExecutor } from '@ottocode/sdk';
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

const SHELL_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const SHELL_PENDING_DELTA_LIMIT_BYTES = 64 * 1024;

function retainUtf8Tail(value: string, limitBytes: number): string {
	const bytes = Buffer.from(value);
	if (bytes.byteLength <= limitBytes) return value;
	let start = bytes.byteLength - limitBytes;
	while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start++;
	return bytes.subarray(start).toString();
}

interface ShellProcess {
	pid?: number;
	usesPty: boolean;
	write: (value: string) => void;
	destroyInput: () => void;
	kill: (signal: NodeJS.Signals) => void;
	onStdout: (listener: (text: string) => void) => void;
	onStderr: (listener: (text: string) => void) => void;
	onClose: (listener: (exitCode: number | null) => void) => void;
	onError: (listener: (error: Error) => void) => void;
	cleanup: () => void;
}

const INTERACTIVE_COMMAND_PATTERN =
	/(?:^|[;&|(\n]\s*)(?:env\s+(?:[^\s=]+=[^\s]+\s+)+)?(?:command\s+)?(?:(?:\S+\/)?git(?:\s+-C\s+(?:"[^"]*"|'[^']*'|\S+))*\s+(?:push|pull|fetch|clone|ls-remote|submodule|lfs)\b|(?:ssh|scp|sftp)\b|rsync\b)/i;

export function commandNeedsPty(cmd: string): boolean {
	return INTERACTIVE_COMMAND_PATTERN.test(cmd);
}

function createShellProcess(args: {
	ctx: ToolAdapterContext;
	cmd: string;
	command: string;
	commandArgs: string[];
	cwd: string;
	env: Record<string, string | undefined>;
}): ShellProcess {
	const terminalManager = commandNeedsPty(args.cmd)
		? getTerminalManager(args.ctx.projectRoot)
		: null;
	if (terminalManager) {
		const terminal = terminalManager.create({
			command: args.command,
			args: args.commandArgs,
			cwd: args.cwd,
			purpose: args.cmd,
			title: 'Interactive shell command',
			createdBy: 'llm',
			inheritEnv: false,
			augmentPath: false,
			env: Object.fromEntries(
				Object.entries(args.env).filter(
					(entry): entry is [string, string] => entry[1] !== undefined,
				),
			),
		});
		return {
			pid: terminal.pid,
			usesPty: true,
			write: (value) => terminal.write(value.replace(/\n$/, '\r')),
			destroyInput: () => {},
			kill: (signal) => terminal.kill(signal),
			onStdout: (listener) => terminal.onData(listener),
			onStderr: () => {},
			onClose: (listener) => terminal.onExit(listener),
			onError: () => {},
			cleanup: () => {
				terminalManager.delete(terminal.id);
			},
		};
	}

	const child = spawn(args.command, args.commandArgs, {
		cwd: args.cwd,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: args.env,
		detached: true,
	});
	return {
		pid: child.pid,
		usesPty: false,
		write: (value) => child.stdin?.write(value),
		destroyInput: () => child.stdin?.destroy(),
		kill: (signal) => child.kill(signal),
		onStdout: (listener) =>
			child.stdout?.on('data', (chunk) => listener(chunk.toString())),
		onStderr: (listener) =>
			child.stderr?.on('data', (chunk) => listener(chunk.toString())),
		onClose: (listener) => child.on('close', listener),
		onError: (listener) => child.on('error', listener),
		cleanup: () => {},
	};
}

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
		const outputLimitBytes = Math.min(
			input.maxOutputBytes && input.maxOutputBytes > 0
				? input.maxOutputBytes
				: SHELL_OUTPUT_LIMIT_BYTES,
			SHELL_OUTPUT_LIMIT_BYTES,
		);
		const envMode = input.envMode ?? 'login-cache';
		const shellConfig = getShellExecutionConfig(cmd, { envMode });
		const proc = createShellProcess({
			ctx,
			cmd,
			command: shellConfig.command,
			commandArgs: shellConfig.args,
			cwd: input.cwd,
			env: shellConfig.env,
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
		let pendingDelta = '';
		let pendingResult: ShellResult | null = null;
		let notify: (() => void) | null = null;

		const wake = () => {
			if (!notify) return;
			notify();
			notify = null;
		};

		const pushDelta = (text: string) => {
			if (!text || streamSettled) return;
			pendingDelta = retainUtf8Tail(
				`${pendingDelta}${text}`,
				SHELL_PENDING_DELTA_LIMIT_BYTES,
			);
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
			proc.cleanup();
			if (!streamSettled) {
				streamSettled = true;
				pendingResult = result;
				done = true;
				wake();
			}
		};

		const detachStream = (jobId: string) => {
			if (streamSettled || processSettled) return;
			detached = true;
			streamSettled = true;
			options?.abortSignal?.removeEventListener('abort', onAbort);
			pendingResult = {
				ok: true,
				detached: true,
				jobId,
				status: 'running',
				stdout,
				stderr,
				envMode,
			};
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
			if (proc.usesPty) {
				proc.write('\x03');
				killEscalationId = setTimeout(() => {
					proc.kill('SIGTERM');
					killEscalationId = setTimeout(() => proc.kill('SIGKILL'), 1000);
				}, 250);
			} else if (proc.pid) {
				killProcessTree(proc.pid);
				killEscalationId = setTimeout(() => {
					if (proc.pid) forceKillProcessTree(proc.pid);
				}, 1000);
			} else {
				proc.kill('SIGTERM');
			}
			proc.destroyInput();
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
			if (securePromptPending || terminating || processSettled) return;
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
				proc.write(`${value}${proc.usesPty ? '\r' : '\n'}`);
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

		proc.onStdout((text) => {
			activeShell?.appendOutput(text);
			stdout =
				outputMode === 'tail'
					? appendTailLines(stdout, text, tailLines)
					: `${stdout}${text}`;
			stdout = retainUtf8Tail(stdout, outputLimitBytes);
			pushDelta(text);
			maybeRequestSecureInput(text);
		});

		proc.onStderr((text) => {
			activeShell?.appendOutput(text);
			stderr =
				outputMode === 'tail'
					? appendTailLines(stderr, text, tailLines)
					: `${stderr}${text}`;
			stderr = retainUtf8Tail(stderr, outputLimitBytes);
			pushDelta(text);
			maybeRequestSecureInput(text);
		});

		proc.onClose((exitCode) => {
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
				const errorMsg = `Command failed with exit code ${resolvedExitCode}${
					errorDetail ? `\n\n${errorDetail}` : ''
				}`;
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

		proc.onError((err) => {
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

		while (!done || pendingDelta || pendingResult) {
			if (!pendingDelta && !pendingResult) {
				await new Promise<void>((resolve) => {
					notify = resolve;
				});
			}
			if (pendingDelta) {
				const delta = pendingDelta;
				pendingDelta = '';
				yield { channel: 'output', delta };
				continue;
			}
			if (pendingResult) {
				const result = pendingResult;
				pendingResult = null;
				yield { result };
			}
		}
	};
}
