import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { logger } from '@ottocode/sdk';
import { resolveRequestProject } from '../project-context.ts';

async function getRequestTerminalManager(c: Context) {
	return (await resolveRequestProject(c)).runtime.terminalManager;
}

const TERMINAL_SSE_MAX_ENTRY_BYTES = 64 * 1024;
const TERMINAL_SSE_MAX_LINE_BYTES = 8 * 1024;
const TERMINAL_SSE_MAX_PENDING_BYTES = 256 * 1024;
const TERMINAL_SSE_MAX_PENDING_ENTRIES = 64;

function retainUtf8Tail(value: string, limitBytes: number): string {
	const bytes = Buffer.from(value);
	if (bytes.byteLength <= limitBytes) return value;
	let start = bytes.byteLength - limitBytes;
	while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start++;
	return bytes.subarray(start).toString();
}

export class BoundedTerminalSseWriter {
	private readonly pending: Array<{ data: string; bytes: number }> = [];
	private readonly drainWaiters: Array<(written: boolean) => void> = [];
	private pendingBytes = 0;
	private writing = false;
	private stopped = false;

	constructor(
		private readonly writeFn: (data: string) => Promise<unknown>,
		private readonly onWriteFailure: (error: unknown) => void,
	) {}

	enqueue(data: string): boolean {
		if (this.stopped) return false;
		const bytes = Buffer.byteLength(data);
		if (bytes > TERMINAL_SSE_MAX_ENTRY_BYTES) return false;
		const entry = { data, bytes };
		while (
			this.pending.length > 0 &&
			(this.pending.length >= TERMINAL_SSE_MAX_PENDING_ENTRIES ||
				this.pendingBytes + entry.bytes > TERMINAL_SSE_MAX_PENDING_BYTES)
		) {
			const removed = this.pending.shift();
			if (removed) this.pendingBytes -= removed.bytes;
		}
		this.pending.push(entry);
		this.pendingBytes += entry.bytes;
		void this.pump();
		return true;
	}

	drain(): Promise<boolean> {
		if (this.stopped) return Promise.resolve(false);
		if (!this.writing && this.pending.length === 0)
			return Promise.resolve(true);
		return new Promise((resolve) => this.drainWaiters.push(resolve));
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.pending.length = 0;
		this.pendingBytes = 0;
		this.resolveDrains(false);
	}

	private async pump(): Promise<void> {
		if (this.writing || this.stopped) return;
		this.writing = true;
		try {
			while (!this.stopped) {
				const entry = this.pending.shift();
				if (!entry) break;
				this.pendingBytes -= entry.bytes;
				await this.writeFn(entry.data);
			}
		} catch (error) {
			this.stop();
			this.onWriteFailure(error);
		} finally {
			this.writing = false;
			if (!this.stopped && this.pending.length > 0) {
				void this.pump();
			} else if (!this.stopped) {
				this.resolveDrains(true);
			}
		}
	}

	private resolveDrains(written: boolean): void {
		for (const resolve of this.drainWaiters.splice(0)) resolve(written);
	}
}

export async function listTerminals(c: Context) {
	const terminalManager = await getRequestTerminalManager(c);
	const terminals = terminalManager.list();
	return {
		terminals: terminals.map((terminal) => terminal.toJSON()),
		count: terminals.length,
	};
}

export async function createTerminal(c: Context) {
	try {
		const { projectRoot, runtime } = await resolveRequestProject(c);
		const body = await c.req.json();
		const { command, args, purpose, cwd, title } = body;

		if (!command || !purpose) {
			return c.json({ error: 'command and purpose are required' }, 400);
		}

		let resolvedCommand = command;
		let resolvedArgs = args || [];
		if (command === 'bash' || command === 'sh' || command === 'shell') {
			resolvedCommand =
				process.platform === 'win32'
					? process.env.COMSPEC || 'cmd.exe'
					: process.env.SHELL || '/bin/bash';
			if (resolvedArgs.length === 0 && process.platform !== 'win32') {
				resolvedArgs = process.platform === 'darwin' ? ['-il'] : ['-i'];
			}
		}
		const resolvedCwd = cwd || projectRoot;

		const terminal = runtime.terminalManager.create({
			command: resolvedCommand,
			args: resolvedArgs,
			purpose,
			cwd: resolvedCwd,
			createdBy: 'user',
			title,
		});

		return c.json({
			terminalId: terminal.id,
			pid: terminal.pid,
			purpose: terminal.purpose,
			command: terminal.command,
		});
	} catch (error) {
		logger.error('Error creating terminal', error);
		const message = error instanceof Error ? error.message : String(error);
		return c.json({ error: message }, 500);
	}
}

export async function getTerminal(c: Context) {
	const terminalManager = await getRequestTerminalManager(c);
	const id = c.req.param('id');
	const terminal = terminalManager.get(id);

	if (!terminal) {
		return c.json({ error: 'Terminal not found' }, 404);
	}

	return c.json({ terminal: terminal.toJSON() });
}

export function createTerminalWebSocketHandler(c: Context) {
	const terminalManagerPromise = getRequestTerminalManager(c).catch((error) => {
		logger.error('Terminal WebSocket project resolution failed', error);
		return null;
	});
	const id = c.req.param('id');
	let onData: ((data: string) => void) | null = null;
	let onExit: ((exitCode: number) => void) | null = null;
	let closed = false;

	return {
		async onOpen(
			_event: unknown,
			ws: {
				send: (data: string) => void;
				close: (code?: number, reason?: string) => void;
			},
		) {
			const terminalManager = await terminalManagerPromise;
			if (closed) return;
			if (!terminalManager) {
				ws.close(1011, 'Terminal project unavailable');
				return;
			}
			const terminal = terminalManager.get(id);
			if (!terminal) {
				ws.close(4004, 'Terminal not found');
				return;
			}

			try {
				const history = terminal.read();
				if (history.length > 0) {
					const replay = history.join('');
					ws.send(
						c.req.query('historyMode') === 'framed'
							? JSON.stringify({ type: 'history', data: replay })
							: replay,
					);
				}
			} catch (error) {
				logger.error('Terminal WebSocket history failed', error, { id });
				ws.close(1011, 'Terminal unavailable');
				return;
			}

			onData = (data: string) => {
				try {
					ws.send(data);
				} catch {
					// ws may be closed
				}
			};

			onExit = (exitCode: number) => {
				try {
					ws.send(JSON.stringify({ type: 'exit', exitCode }));
					ws.close(1000, 'Process exited');
				} catch {
					// ws may already be closed
				}
			};

			try {
				terminal.onData(onData);
				terminal.onExit(onExit);
			} catch (error) {
				logger.error('Terminal WebSocket listener setup failed', error, { id });
				ws.close(1011, 'Terminal unavailable');
				return;
			}

			if (terminal.status === 'exited') {
				onExit(terminal.exitCode ?? 0);
			}
		},
		async onMessage(event: { data: unknown }, _ws: unknown) {
			const terminalManager = await terminalManagerPromise;
			if (closed || !terminalManager) return;
			const terminal = terminalManager.get(id);
			if (!terminal) return;

			const raw = event.data;
			const message =
				typeof raw === 'string'
					? raw
					: raw instanceof ArrayBuffer
						? new TextDecoder().decode(raw)
						: String(raw);

			if (message.startsWith('{')) {
				try {
					const msg = JSON.parse(message);
					if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
						try {
							terminal.resize(msg.cols, msg.rows);
						} catch (error) {
							logger.error('Terminal WebSocket resize failed', error, { id });
						}
						return;
					}
				} catch {
					// not JSON, treat as input
				}
			}

			try {
				terminal.write(message);
			} catch (error) {
				logger.error('Terminal WebSocket input failed', error, { id });
			}
		},
		async onClose() {
			closed = true;
			const terminalManager = await terminalManagerPromise;
			if (!terminalManager) return;
			const terminal = terminalManager.get(id);
			if (terminal) {
				if (onData) terminal.removeDataListener(onData);
				if (onExit) terminal.removeExitListener(onExit);
			}
			onData = null;
			onExit = null;
		},
		async onError() {
			closed = true;
			const terminalManager = await terminalManagerPromise;
			if (!terminalManager) return;
			const terminal = terminalManager.get(id);
			if (terminal) {
				if (onData) terminal.removeDataListener(onData);
				if (onExit) terminal.removeExitListener(onExit);
			}
			onData = null;
			onExit = null;
		},
	};
}

export async function handleTerminalOutput(c: Context) {
	const terminalManager = await getRequestTerminalManager(c);
	const id = c.req.param('id');
	const terminal = terminalManager.get(id);

	if (!terminal) {
		return c.json({ error: 'Terminal not found' }, 404);
	}

	const activeTerminal = terminal;

	return streamSSE(c, async (stream) => {
		let resolveStream: (() => void) | null = null;
		let finished = false;
		let exiting = false;
		let writer: BoundedTerminalSseWriter | null = null;
		let hb: ReturnType<typeof setInterval> | null = null;

		const serializeEvent = (payload: Record<string, unknown>) => {
			const boundedPayload =
				typeof payload.line === 'string'
					? {
							...payload,
							line: retainUtf8Tail(payload.line, TERMINAL_SSE_MAX_LINE_BYTES),
						}
					: payload;
			return `data: ${JSON.stringify(boundedPayload)}\n\n`;
		};

		const onData = (line: string) => {
			writer?.enqueue(serializeEvent({ type: 'data', line }));
		};

		function cleanup() {
			activeTerminal.removeDataListener(onData);
			activeTerminal.removeExitListener(onExit);
			c.req.raw.signal.removeEventListener('abort', onAbort);
			if (hb) clearInterval(hb);
			hb = null;
		}

		function finish() {
			if (finished) return;
			finished = true;
			cleanup();
			writer?.stop();
			resolveStream?.();
		}

		writer = new BoundedTerminalSseWriter(
			(data) => stream.write(data),
			(error) => {
				logger.error('SSE error writing terminal event', error, { id });
				stream.close();
				finish();
			},
		);

		async function onExit(exitCode: number) {
			if (finished || exiting) return;
			exiting = true;
			writer?.enqueue(serializeEvent({ type: 'exit', exitCode }));
			await writer?.drain();
			stream.close();
			finish();
		}

		function onAbort() {
			stream.close();
			finish();
		}

		try {
			const waitForClose = new Promise<void>((resolve) => {
				resolveStream = resolve;
			});
			const skipHistory = c.req.query('skipHistory') === 'true';
			if (!skipHistory) {
				for (const line of activeTerminal.read()) {
					if (!writer.enqueue(serializeEvent({ type: 'data', line }))) break;
				}
			}

			activeTerminal.onData(onData);
			activeTerminal.onExit(onExit);
			if (c.req.raw.signal.aborted) {
				onAbort();
			} else {
				c.req.raw.signal.addEventListener('abort', onAbort, { once: true });
				hb = setInterval(() => {
					writer?.enqueue(`: hb ${Date.now()}\n\n`);
				}, 15000);
				if (terminal.status === 'exited') {
					void onExit(terminal.exitCode ?? 0);
				}
			}

			await waitForClose;
		} finally {
			finish();
		}
	});
}

export async function sendTerminalInput(c: Context) {
	const terminalManager = await getRequestTerminalManager(c);
	const id = c.req.param('id');
	const terminal = terminalManager.get(id);

	if (!terminal) {
		return c.json({ error: 'Terminal not found' }, 404);
	}

	try {
		const body = await c.req.json();
		const { input } = body;

		if (!input) {
			return c.json({ error: 'input is required' }, 400);
		}

		terminal.write(input);
		return c.json({ success: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return c.json({ error: message }, 500);
	}
}

export async function killTerminal(c: Context) {
	const terminalManager = await getRequestTerminalManager(c);
	const id = c.req.param('id');

	try {
		await terminalManager.kill(id);
		return c.json({ success: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return c.json({ error: message }, 500);
	}
}

export async function resizeTerminal(c: Context) {
	const terminalManager = await getRequestTerminalManager(c);
	const id = c.req.param('id');
	const terminal = terminalManager.get(id);

	if (!terminal) {
		return c.json({ error: 'Terminal not found' }, 404);
	}

	try {
		const body = await c.req.json();
		const { cols, rows } = body;

		if (!cols || !rows || cols < 1 || rows < 1) {
			return c.json({ error: 'valid cols and rows are required' }, 400);
		}

		terminal.resize(cols, rows);
		return c.json({ success: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return c.json({ error: message }, 500);
	}
}
