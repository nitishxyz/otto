import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { logger } from '@ottocode/sdk';
import { resolveRequestProject } from '../project-context.ts';

async function getRequestTerminalManager(c: Context) {
	return (await resolveRequestProject(c)).runtime.terminalManager;
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
	const terminalManagerPromise = getRequestTerminalManager(c);
	const id = c.req.param('id');
	let onData: ((data: string) => void) | null = null;
	let onExit: ((exitCode: number) => void) | null = null;

	return {
		async onOpen(
			_event: unknown,
			ws: {
				send: (data: string) => void;
				close: (code?: number, reason?: string) => void;
			},
		) {
			const terminalManager = await terminalManagerPromise;
			const terminal = terminalManager.get(id);
			if (!terminal) {
				ws.close(4004, 'Terminal not found');
				return;
			}

			const history = terminal.read();
			for (const chunk of history) {
				ws.send(chunk);
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

			terminal.onData(onData);
			terminal.onExit(onExit);

			if (terminal.status === 'exited') {
				onExit(terminal.exitCode ?? 0);
			}
		},
		async onMessage(event: { data: unknown }, _ws: unknown) {
			const terminalManager = await terminalManagerPromise;
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
						terminal.resize(msg.cols, msg.rows);
						return;
					}
				} catch {
					// not JSON, treat as input
				}
			}

			terminal.write(message);
		},
		async onClose() {
			const terminalManager = await terminalManagerPromise;
			const terminal = terminalManager.get(id);
			if (terminal) {
				if (onData) terminal.removeDataListener(onData);
				if (onExit) terminal.removeExitListener(onExit);
			}
			onData = null;
			onExit = null;
		},
		async onError() {
			const terminalManager = await terminalManagerPromise;
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
		const skipHistory = c.req.query('skipHistory') === 'true';
		if (!skipHistory) {
			const history = activeTerminal.read();
			for (const line of history) {
				await stream.write(
					`data: ${JSON.stringify({ type: 'data', line })}\n\n`,
				);
			}
		}

		const sendEvent = async (payload: Record<string, unknown>) => {
			try {
				await stream.write(`data: ${JSON.stringify(payload)}\n\n`);
			} catch (error) {
				logger.error('SSE error writing event', error, { id });
			}
		};

		const onData = (line: string) => {
			void sendEvent({ type: 'data', line });
		};

		let resolveStream: (() => void) | null = null;
		let finished = false;

		const hb = setInterval(async () => {
			try {
				await stream.write(`: hb ${Date.now()}\n\n`);
			} catch {
				clearInterval(hb);
			}
		}, 15000);

		function cleanup() {
			activeTerminal.removeDataListener(onData);
			activeTerminal.removeExitListener(onExit);
			c.req.raw.signal.removeEventListener('abort', onAbort);
			clearInterval(hb);
		}

		function finish() {
			if (finished) {
				return;
			}
			finished = true;
			cleanup();
			resolveStream?.();
		}

		async function onExit(exitCode: number) {
			try {
				await sendEvent({ type: 'exit', exitCode });
			} finally {
				stream.close();
				finish();
			}
		}

		function onAbort() {
			stream.close();
			finish();
		}

		terminal.onData(onData);
		terminal.onExit(onExit);

		c.req.raw.signal.addEventListener('abort', onAbort, { once: true });

		const waitForClose = new Promise<void>((resolve) => {
			resolveStream = resolve;
		});

		if (terminal.status === 'exited') {
			void onExit(terminal.exitCode ?? 0);
		}

		await waitForClose;
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
