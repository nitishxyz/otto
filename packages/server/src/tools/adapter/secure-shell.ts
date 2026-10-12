import { getTerminalManager, type ShellExecutor } from '@ottocode/sdk';
import { getShellExecutionConfigAsync } from '@ottocode/sdk/tools/bin-manager';
import {
	ShellExecution,
	createPipeShellProcess,
	formatShellResult,
	detectShellEnvHint,
	type ShellProcess,
	type ShellExecutionResult,
} from '@ottocode/sdk/tools/builtin/shell';
import { createToolError } from '@ottocode/sdk/tools/error';
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

const INTERACTIVE_COMMAND_PATTERN =
	/(?:^|[;&|(\n]\s*)(?:env\s+(?:[^\s=]+=[^\s]+\s+)+)?(?:command\s+)?(?:(?:\S+\/)?git(?:\s+-C\s+(?:"[^"]*"|'[^']*'|\S+))*\s+(?:push|pull|fetch|clone|ls-remote|submodule|lfs)\b|(?:ssh|scp|sftp)\b|rsync\b)/i;

export function commandNeedsPty(cmd: string): boolean {
	return INTERACTIVE_COMMAND_PATTERN.test(cmd);
}

function createShellProcess(args: {
	ctx: ToolAdapterContext;
	cmd: string;
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string | undefined>;
}): ShellProcess {
	if (!commandNeedsPty(args.cmd)) return createPipeShellProcess(args);
	const manager = getTerminalManager(args.ctx.projectRoot);
	if (!manager) return createPipeShellProcess(args);
	const terminal = manager.create({
		command: args.command,
		args: args.args,
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
			manager.delete(terminal.id);
		},
	};
}

export function createSecureShellExecutor(args: {
	ctx: ToolAdapterContext;
	callId?: string;
}): ShellExecutor {
	const { ctx, callId } = args;
	return async function* secureShellExecutor(input, options) {
		const cmd = normalizeSudoCommand(input.cmd);
		const timeout = input.timeout ?? 300000;
		const outputMode = input.outputMode ?? 'auto';
		const tailLines = input.tailLines ?? 100;
		const maxOutputBytes = input.maxOutputBytes ?? 128_000;
		const envMode = input.envMode ?? 'login-cache';
		const shellConfig = await getShellExecutionConfigAsync(cmd, { envMode });
		if (options?.abortSignal?.aborted) {
			yield {
				result: createToolError('Command aborted before execution', 'abort', {
					cmd,
				}),
			};
			return;
		}
		let recentOutput = '';
		let lastSecureInputCacheKey: string | null = null;
		let securePromptPending = false;
		let activeShell: ActiveShellRegistration | undefined;
		const execution = new ShellExecution<ShellExecutionResult>({
			spawn: () =>
				createShellProcess({ ctx, cmd, ...shellConfig, cwd: input.cwd }),
			timeout,
			outputMode,
			tailLines,
			maxOutputBytes,
			abortSignal: options?.abortSignal,
			format: (outcome) => {
				if (
					lastSecureInputCacheKey &&
					hasAuthenticationFailure(`${outcome.stdout}\n${outcome.stderr}`)
				) {
					invalidateCachedSecureInput(ctx.projectRoot, lastSecureInputCacheKey);
				}
				return formatShellResult(outcome, {
					cmd: input.cmd,
					timeout,
					allowNonZeroExit: input.allowNonZeroExit,
					envMode,
					envHint: detectShellEnvHint({
						...outcome,
						exitCode: outcome.exitCode ?? 1,
						envMode,
					}),
				});
			},
			onComplete: (result, outcome) => {
				activeShell?.complete({
					status: result.ok
						? 'completed'
						: result.errorType === 'abort'
							? 'cancelled'
							: 'failed',
					result,
					exitCode: outcome.exitCode,
				});
			},
			onOutput: (text) => {
				activeShell?.appendOutput(text);
				recentOutput = `${recentOutput}${text}`.slice(-1000);
				if (securePromptPending || execution.terminating || execution.settled)
					return;
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
				})
					.then((value) => {
						securePromptPending = false;
						recentOutput = '';
						if (value === null) execution.cancel();
						else execution.write(`${value}${execution.usesPty ? '\r' : '\n'}`);
					})
					.catch((error: unknown) => {
						securePromptPending = false;
						execution.cancel(
							'execution',
							new Error(
								`Secure input failed: ${error instanceof Error ? error.message : String(error)}`,
							),
						);
					});
			},
		});
		activeShell = registerActiveShellProcess({
			projectRoot: ctx.projectRoot,
			sessionId: ctx.sessionId,
			messageId: ctx.messageId,
			callId,
			command: input.cmd,
			cwd: input.cwd,
			abort: () => execution.cancel(),
			onDetach: (jobId) => {
				execution.detach((outcome) => ({
					ok: true,
					detached: true,
					jobId,
					status: 'running',
					stdout: outcome.stdout,
					stderr: outcome.stderr,
					envMode,
					...outcome.metadata,
				}));
			},
			onDetachedCompletion: (sessionId, projectRoot) => {
				void import('../../runtime/shell-jobs/report.ts').then(
					({ reportFinishedShellJobsWhenIdle }) =>
						reportFinishedShellJobsWhenIdle(sessionId, projectRoot),
				);
			},
		});
		execution.start();
		if (input.detached) activeShell.detach();
		yield* execution.stream();
	};
}
