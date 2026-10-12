import { spawn as spawnChild } from 'node:child_process';
import type { IPty, IExitEvent, PtyOptions } from './bun-pty.ts';
import { PTY_HELPER_SOURCE } from './pty-helper.ts';

const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

type HelperMessage =
	| { type: 'ready'; pid: number }
	| { type: 'ack' }
	| { type: 'data'; data: string }
	| { type: 'exit'; exitCode: number };

/** Isolates macOS forkpty from the multithreaded server; retains a real PTY. */
export function spawnIsolatedPty(
	command: string,
	args: string[],
	options: PtyOptions,
): IPty {
	const child = spawnChild(
		process.execPath,
		['--no-env-file', '--eval', PTY_HELPER_SOURCE],
		{
			// A compiled Bun executable exposes its runtime with this flag.
			env: { BUN_BE_BUN: '1' },
			stdio: ['pipe', 'pipe', 'pipe'],
			detached: true,
		},
	);
	let pid = child.pid ?? 0;
	let ready = false;
	let pending = '';
	let exitEvent: IExitEvent | undefined;
	let killDeadline: ReturnType<typeof setTimeout> | undefined;
	let failureDeadline: ReturnType<typeof setTimeout> | undefined;
	const dataListeners = new Set<(data: string) => void>();
	const exitListeners = new Set<(event: IExitEvent) => void>();
	const pendingData: string[] = [];
	let pendingDataBytes = 0;
	let controlBytes = 0;
	let controlInFlight = false;
	const controls: string[] = [];
	const emitData = (data: string) => {
		if (dataListeners.size === 0) {
			pendingDataBytes += Buffer.byteLength(data);
			if (pendingDataBytes > MAX_BUFFER_BYTES) {
				failTransport();
				return;
			}
			pendingData.push(data);
		} else for (const listener of dataListeners) listener(data);
	};
	const settle = (exitCode: number) => {
		if (exitEvent) return;
		clearTimeout(startDeadline);
		clearTimeout(killDeadline);
		exitEvent = { exitCode };
		child.stdin.destroy();
		controls.length = 0;
		controlBytes = 0;
		for (const listener of exitListeners) listener(exitEvent);
	};
	const forceStop = () => {
		if (ready) {
			try {
				process.kill(-pid, 'SIGKILL');
			} catch {
				try {
					process.kill(pid, 'SIGKILL');
				} catch {}
			}
		}
		child.kill('SIGKILL');
	};
	const startDeadline = setTimeout(() => {
		forceStop();
		settle(1);
	}, 5000);
	const failTransport = () => {
		if (failureDeadline) return;
		// EOF lets the helper kill its group even before ready reaches the parent.
		child.stdin.destroy();
		failureDeadline = setTimeout(() => {
			forceStop();
			settle(1);
		}, 1000);
		pending = '';
		pendingData.length = 0;
		pendingDataBytes = 0;
		controls.length = 0;
		controlBytes = 0;
	};
	const flushControl = () => {
		if (controlInFlight || child.stdin.destroyed || !controls.length) return;
		const frame = controls.shift();
		if (!frame) return;
		controlBytes -= Buffer.byteLength(frame);
		controlInFlight = true;
		child.stdin.write(frame);
	};
	const send = (message: object) => {
		if (exitEvent || child.stdin.destroyed) return;
		const frame = `${JSON.stringify(message)}\n`;
		const bytes = Buffer.byteLength(frame);
		if (bytes > MAX_FRAME_BYTES || controlBytes + bytes > MAX_BUFFER_BYTES) {
			failTransport();
			return;
		}
		controls.push(frame);
		controlBytes += bytes;
		flushControl();
	};
	child.stdin.on('error', () => {});
	child.stderr.resume();
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (data: string) => {
		pending += data;
		let newline = pending.indexOf('\n');
		while (newline !== -1) {
			const line = pending.slice(0, newline);
			pending = pending.slice(newline + 1);
			try {
				if (Buffer.byteLength(line) > MAX_FRAME_BYTES)
					throw new Error('Invalid PTY frame');
				const message = JSON.parse(line) as HelperMessage;
				if (
					message.type === 'ready' &&
					Number.isSafeInteger(message.pid) &&
					message.pid > 0 &&
					!ready
				) {
					pid = message.pid;
					ready = true;
					clearTimeout(startDeadline);
				} else if (message.type === 'ack' && controlInFlight) {
					controlInFlight = false;
					flushControl();
				} else if (
					message.type === 'data' &&
					typeof message.data === 'string'
				) {
					emitData(message.data);
					send({ type: 'outputAck', bytes: Buffer.byteLength(line) + 1 });
				} else if (
					message.type === 'exit' &&
					Number.isInteger(message.exitCode)
				)
					settle(message.exitCode);
				else throw new Error('Invalid PTY frame');
			} catch {
				failTransport();
				return;
			}
			newline = pending.indexOf('\n');
		}
		if (Buffer.byteLength(pending) > MAX_FRAME_BYTES) {
			failTransport();
		}
	});
	child.on('error', () => settle(1));
	child.on('close', (code) => {
		clearTimeout(failureDeadline);
		if (!exitEvent) {
			forceStop();
			settle(code ?? 1);
		}
	});
	send({
		type: 'start',
		command,
		args,
		options: { ...options, env: options.env ?? { ...process.env } },
	});
	return {
		get pid() {
			return pid;
		},
		write: (data) => {
			for (
				let offset = 0;
				offset < data.length && !exitEvent;
				offset += 16384
			) {
				let end = Math.min(offset + 16384, data.length);
				const last = data.charCodeAt(end - 1);
				if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--;
				send({ type: 'write', data: data.slice(offset, end) });
				offset = end - 16384;
			}
		},
		resize: (cols, rows) => send({ type: 'resize', cols, rows }),
		kill: (signal = 'SIGTERM') => {
			if (exitEvent) return;
			send({ type: 'kill', signal });
			if (signal === 'SIGKILL') {
				clearTimeout(killDeadline);
				killDeadline = setTimeout(() => {
					forceStop();
					settle(1);
				}, 1000);
			}
		},
		onData: (callback) => {
			dataListeners.add(callback);
			pendingDataBytes = 0;
			for (const data of pendingData.splice(0)) callback(data);
		},
		onExit: (callback) => {
			if (exitEvent) queueMicrotask(() => callback(exitEvent as IExitEvent));
			else exitListeners.add(callback);
		},
	};
}
