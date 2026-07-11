import { afterEach, describe, expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
	clearTerminalWebSocketTickets,
	createTerminalWebSocketTicket,
} from '../packages/server/src/routes/terminals/ws-ticket.ts';
import {
	clearTunnelShares,
	createTunnelShare,
	revokeTunnelShare,
} from '../packages/server/src/routes/tunnel/shares.ts';
import { tunnelAuthMiddleware } from '../packages/server/src/tunnel-auth.ts';

function app() {
	const instance = new OpenAPIHono();
	instance.use('*', tunnelAuthMiddleware);
	instance.get('/v1/terminals/:id/ws', (c) =>
		c.json({
			terminalId: c.req.param('id'),
			projectId: c.req.header('x-otto-project-id') ?? null,
		}),
	);
	return instance;
}

afterEach(() => {
	clearTerminalWebSocketTickets();
	clearTunnelShares();
});

describe('terminal tunnel WebSocket tickets', () => {
	test('rejects tunneled WebSocket path without a ticket', async () => {
		const response = await app().request(
			'https://machine.example/v1/terminals/term-1/ws',
		);
		expect(response.status).toBe(401);
	});

	test('accepts one-time owner ticket pinned to its terminal and project', async () => {
		const { ticket } = createTerminalWebSocketTicket({
			terminalId: 'term-1',
			projectId: 'project-owner',
		});
		const response = await app().request(
			`https://machine.example/v1/terminals/term-1/ws?ticket=${ticket}`,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			terminalId: 'term-1',
			projectId: 'project-owner',
		});
		const replay = await app().request(
			`https://machine.example/v1/terminals/term-1/ws?ticket=${ticket}`,
		);
		expect(replay.status).toBe(401);
	});

	test('rejects ticket used for the wrong terminal', async () => {
		const { ticket } = createTerminalWebSocketTicket({ terminalId: 'term-1' });
		const response = await app().request(
			`https://machine.example/v1/terminals/term-2/ws?ticket=${ticket}`,
		);
		expect(response.status).toBe(401);
	});

	test('pins active share tickets and denies revoked shares', async () => {
		const share = createTunnelShare('project-share', 'https://machine.example');
		const active = createTerminalWebSocketTicket({
			terminalId: 'term-share',
			projectId: 'attacker-project',
			shareToken: share.token,
		});
		const allowed = await app().request(
			`https://machine.example/v1/terminals/term-share/ws?ticket=${active.ticket}`,
		);
		expect(allowed.status).toBe(200);
		expect((await allowed.json()).projectId).toBe('project-share');

		const revoked = createTerminalWebSocketTicket({
			terminalId: 'term-share',
			shareToken: share.token,
		});
		revokeTunnelShare(share.id);
		const denied = await app().request(
			`https://machine.example/v1/terminals/term-share/ws?ticket=${revoked.ticket}`,
		);
		expect(denied.status).toBe(401);
	});
});
