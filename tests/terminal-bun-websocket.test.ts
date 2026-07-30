import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	bunWebSocket,
	createStandaloneApp,
	setDefaultProjectRoot,
	shutdownProjectManager,
} from '../packages/server/src/index.ts';
import { getProjectManager } from '../packages/server/src/runtime/projects/manager.ts';

const roots: string[] = [];

async function startServer(defaultProject: string | null) {
	setDefaultProjectRoot(defaultProject);
	const app = createStandaloneApp();
	const server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch: app.fetch,
		websocket: bunWebSocket,
	});
	return { server, baseUrl: `http://127.0.0.1:${server.port}` };
}

async function createTicket(
	baseUrl: string,
	terminalId: string,
	project: string,
) {
	const response = await fetch(
		`${baseUrl}/v1/terminals/${terminalId}/ws-ticket?projectId=${encodeURIComponent(
			project,
		)}`,
		{ method: 'POST' },
	);
	expect(response.status).toBe(200);
	return ((await response.json()) as { ticket: string }).ticket;
}

async function createTerminal(baseUrl: string, project: string) {
	const response = await fetch(
		`${baseUrl}/v1/terminals?project=${encodeURIComponent(project)}`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ command: '/bin/cat', purpose: 'WS regression' }),
		},
	);
	expect(response.status).toBe(200);
	return (await response.json()) as { terminalId: string };
}

function seedTerminalHistory(url: string, inputs: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		let index = 0;
		const timeout = setTimeout(() => {
			ws.close();
			reject(new Error('WebSocket history setup timed out'));
		}, 5_000);
		ws.onopen = () => ws.send(`${inputs[index]}\n`);
		ws.onmessage = (event) => {
			if (!String(event.data).includes(inputs[index])) return;
			index += 1;
			if (index < inputs.length) {
				ws.send(`${inputs[index]}\n`);
				return;
			}
			clearTimeout(timeout);
			ws.close();
			resolve();
		};
		ws.onerror = () => {
			clearTimeout(timeout);
			reject(new Error('WebSocket history setup failed'));
		};
	});
}

function readFirstFrame(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const timeout = setTimeout(() => {
			ws.close();
			reject(new Error('WebSocket history replay timed out'));
		}, 5_000);
		ws.onmessage = (event) => {
			clearTimeout(timeout);
			ws.close();
			resolve(String(event.data));
		};
		ws.onerror = () => {
			clearTimeout(timeout);
			reject(new Error('WebSocket history replay failed'));
		};
	});
}

function roundTrip(url: string, input: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		const timeout = setTimeout(() => {
			ws.close();
			reject(new Error('WebSocket roundtrip timed out'));
		}, 5_000);
		ws.onopen = () => ws.send(`${input}\n`);
		ws.onmessage = (event) => {
			if (!String(event.data).includes(input)) return;
			clearTimeout(timeout);
			ws.close();
			resolve();
		};
		ws.onerror = () => {
			clearTimeout(timeout);
			reject(new Error('WebSocket failed'));
		};
	});
}

afterEach(async () => {
	await shutdownProjectManager();
	setDefaultProjectRoot(null);
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe('actual Bun terminal WebSocket lifecycle', () => {
	test('local create, direct WS roundtrip, close, and health remain functional', async () => {
		const project = await mkdtemp(join(tmpdir(), 'otto-terminal-bun-'));
		roots.push(project);
		const { server, baseUrl } = await startServer(project);
		try {
			const { terminalId } = await createTerminal(baseUrl, project);
			await roundTrip(
				`${baseUrl.replace(
					'http:',
					'ws:',
				)}/v1/terminals/${terminalId}/ws?project=${encodeURIComponent(
					project,
				)}`,
				'local-roundtrip',
			);
			expect((await fetch(`${baseUrl}/`)).status).toBe(200);
		} finally {
			server.stop(true);
		}
	});

	test('ticket-based local client preserves project context through upgrade', async () => {
		const project = await mkdtemp(join(tmpdir(), 'otto-terminal-ticket-'));
		roots.push(project);
		const { server, baseUrl } = await startServer(null);
		try {
			const { terminalId } = await createTerminal(baseUrl, project);
			const projectId = (
				await getProjectManager().getProject({ path: project })
			).id;
			const ticket = await createTicket(baseUrl, terminalId, projectId);
			await roundTrip(
				`${baseUrl.replace(
					'http:',
					'ws:',
				)}/v1/terminals/${terminalId}/ws?ticket=${ticket}`,
				'ticket-roundtrip',
			);
			expect((await fetch(`${baseUrl}/`)).status).toBe(200);
		} finally {
			server.stop(true);
		}
	});

	test('frames buffered history explicitly for native desktop clients', async () => {
		const project = await mkdtemp(join(tmpdir(), 'otto-terminal-framed-history-'));
		roots.push(project);
		const { server, baseUrl } = await startServer(project);
		try {
			const { terminalId } = await createTerminal(baseUrl, project);
			const wsUrl = `${baseUrl.replace(
				'http:',
				'ws:',
			)}/v1/terminals/${terminalId}/ws?project=${encodeURIComponent(project)}`;
			await seedTerminalHistory(wsUrl, ['framed-one', 'framed-two']);
			const frame = JSON.parse(
				await readFirstFrame(`${wsUrl}&historyMode=framed`),
			) as { type: string; data: string };
			expect(frame.type).toBe('history');
			expect(frame.data).toContain('framed-one');
			expect(frame.data).toContain('framed-two');
		} finally {
			server.stop(true);
		}
	});

	test('replays buffered history in one WebSocket frame', async () => {
		const project = await mkdtemp(join(tmpdir(), 'otto-terminal-history-'));
		roots.push(project);
		const { server, baseUrl } = await startServer(project);
		try {
			const { terminalId } = await createTerminal(baseUrl, project);
			const wsUrl = `${baseUrl.replace(
				'http:',
				'ws:',
			)}/v1/terminals/${terminalId}/ws?project=${encodeURIComponent(project)}`;
			const markers = ['history-one', 'history-two', 'history-three'];
			await seedTerminalHistory(wsUrl, markers);
			const replay = await readFirstFrame(wsUrl);
			for (const marker of markers) expect(replay).toContain(marker);
		} finally {
			server.stop(true);
		}
	});

	test('repeated create/connect/close does not crash the Bun server', async () => {
		const project = await mkdtemp(join(tmpdir(), 'otto-terminal-stress-'));
		roots.push(project);
		const { server, baseUrl } = await startServer(project);
		try {
			for (let index = 0; index < 8; index += 1) {
				const { terminalId } = await createTerminal(baseUrl, project);
				await roundTrip(
					`${baseUrl.replace(
						'http:',
						'ws:',
					)}/v1/terminals/${terminalId}/ws?project=${encodeURIComponent(
						project,
					)}`,
					`stress-${index}`,
				);
			}
			expect((await fetch(`${baseUrl}/`)).status).toBe(200);
		} finally {
			server.stop(true);
		}
	});

	test('upgrade with missing project context closes safely and daemon stays healthy', async () => {
		const { server, baseUrl } = await startServer(null);
		try {
			await new Promise<void>((resolve) => {
				const ws = new WebSocket(
					`${baseUrl.replace('http:', 'ws:')}/v1/terminals/missing/ws`,
				);
				const timeout = setTimeout(() => {
					ws.close();
					resolve();
				}, 2_000);
				ws.onclose = () => {
					clearTimeout(timeout);
					resolve();
				};
				ws.onerror = () => {};
			});
			expect((await fetch(`${baseUrl}/`)).status).toBe(200);
		} finally {
			server.stop(true);
		}
	});
});
