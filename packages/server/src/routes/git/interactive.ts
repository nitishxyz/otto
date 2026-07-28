import { getTerminalManager } from '@ottocode/sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { attachTerminalSecureInput } from '../../runtime/tools/terminal-secure-input.ts';
import { cleanPromptOutput } from '../../runtime/tools/secure-prompt.ts';

const execFileAsync = promisify(execFile);
const GIT_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

export interface GitCommandResult {
	stdout: string;
	stderr: string;
}

/** Runs network git commands in a PTY when a session can answer prompts. */
export async function runInteractiveGitCommand(args: {
	projectRoot: string;
	sessionId?: string;
	cwd: string;
	gitArgs: string[];
	operation: 'commit' | 'pull' | 'push';
	gitCommand?: string;
}): Promise<GitCommandResult> {
	const gitCommand = args.gitCommand ?? 'git';
	const gitEnv = Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] =>
				entry[1] !== undefined && entry[0] !== 'GPG_TTY',
		),
	);
	if (!args.sessionId) {
		return execFileAsync(gitCommand, args.gitArgs, {
			cwd: args.cwd,
			env: { ...gitEnv, GIT_TERMINAL_PROMPT: '0' },
			timeout: GIT_OPERATION_TIMEOUT_MS,
		});
	}
	const terminalManager = getTerminalManager(args.projectRoot);
	if (!terminalManager) {
		throw new Error(
			`git ${args.operation} cannot start because the project terminal is unavailable`,
		);
	}

	const terminal = terminalManager.create({
		command: gitCommand,
		args: args.gitArgs,
		cwd: args.cwd,
		purpose: `git ${args.operation}`,
		title: `Git ${args.operation}`,
		createdBy: 'user',
		inheritEnv: false,
		env: { ...gitEnv, GIT_TERMINAL_PROMPT: '1' },
	});

	attachTerminalSecureInput({
		ctx: {
			projectRoot: args.projectRoot,
			sessionId: args.sessionId,
			messageId: `git-${args.operation}-${crypto.randomUUID()}`,
		},
		terminalId: terminal.id,
	});

	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const exitCode = await new Promise<number>((resolve, reject) => {
			if (terminal.status === 'exited') {
				resolve(terminal.exitCode ?? 0);
				return;
			}

			const onExit = (code: number) => {
				if (timeout) clearTimeout(timeout);
				terminal.removeExitListener(onExit);
				resolve(code);
			};
			terminal.onExit(onExit);
			timeout = setTimeout(() => {
				terminal.removeExitListener(onExit);
				terminal.kill();
				reject(new Error(`git ${args.operation} timed out`));
			}, GIT_OPERATION_TIMEOUT_MS);
		});

		const output = cleanPromptOutput(terminal.read().join('')).trim();
		if (exitCode !== 0) {
			throw new Error(
				output || `git ${args.operation} exited with ${exitCode}`,
			);
		}

		return { stdout: output, stderr: '' };
	} finally {
		if (timeout) clearTimeout(timeout);
		terminalManager.delete(terminal.id);
	}
}
