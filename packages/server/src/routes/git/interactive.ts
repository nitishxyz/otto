import { getTerminalManager } from '@ottocode/sdk';
import { attachTerminalSecureInput } from '../../runtime/tools/terminal-secure-input.ts';
import { cleanPromptOutput } from '../../runtime/tools/secure-prompt.ts';

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
	operation: 'pull' | 'push';
	gitCommand?: string;
}): Promise<GitCommandResult> {
	const gitCommand = args.gitCommand ?? 'git';
	if (!args.sessionId) {
		throw new Error(
			`git ${args.operation} requires an active session to handle authentication prompts`,
		);
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
		env: { GIT_TERMINAL_PROMPT: '1' },
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
