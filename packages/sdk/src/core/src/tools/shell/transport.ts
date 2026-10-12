import { spawn } from 'node:child_process';

export interface ShellProcess {
	pid?: number;
	usesPty: boolean;
	write(value: string): void;
	destroyInput(): void;
	kill(signal: NodeJS.Signals): void;
	onStdout(listener: (text: string) => void): void;
	onStderr(listener: (text: string) => void): void;
	onClose(
		listener: (code: number | null, signal?: NodeJS.Signals | null) => void,
	): void;
	onError(listener: (error: Error) => void): void;
	cleanup(): void;
}

export function createPipeShellProcess(args: {
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string | undefined>;
}): ShellProcess {
	const child = spawn(args.command, args.args, {
		cwd: args.cwd,
		env: args.env,
		stdio: ['pipe', 'pipe', 'pipe'],
		detached: true,
	});
	return {
		pid: child.pid,
		usesPty: false,
		write: (value) => {
			child.stdin?.write(value);
		},
		destroyInput: () => child.stdin?.destroy(),
		kill: (signal) => {
			if (child.pid) {
				try {
					process.kill(-child.pid, signal);
					return;
				} catch {}
			}
			child.kill(signal);
		},
		onStdout: (listener) =>
			child.stdout?.on('data', (chunk) => listener(chunk.toString())),
		onStderr: (listener) =>
			child.stderr?.on('data', (chunk) => listener(chunk.toString())),
		onClose: (listener) => {
			child.on('close', listener);
		},
		onError: (listener) => {
			child.on('error', listener);
		},
		cleanup: () => {},
	};
}
