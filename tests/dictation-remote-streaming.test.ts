import { afterEach, describe, expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { resolveDictationWebSocketUrl } from '../packages/web-sdk/src/lib/api-client/dictation.ts';
import {
	clearDictationWebSocketTickets,
	createDictationWebSocketTicket,
} from '../packages/server/src/routes/dictation/ws-ticket.ts';
import {
	clearTunnelShares,
	createTunnelShare,
	revokeTunnelShare,
} from '../packages/server/src/routes/tunnel/shares.ts';
import { tunnelAuthMiddleware } from '../packages/server/src/tunnel-auth.ts';

function app() {
	const instance = new OpenAPIHono();
	instance.use('*', tunnelAuthMiddleware);
	instance.get('/v1/dictation/sessions/:id/ws', (c) =>
		c.json({
			sessionId: c.req.param('id'),
			projectId: c.req.header('x-otto-project-id') ?? null,
		}),
	);
	return instance;
}

afterEach(() => {
	clearDictationWebSocketTickets();
	clearTunnelShares();
});

describe('remote dictation streaming', () => {
	test('uses the configured remote API origin for the WebSocket', () => {
		expect(
			resolveDictationWebSocketUrl(
				'ws://127.0.0.1:4312/v1/dictation/sessions/session-1/ws?ticket=secret',
				'https://machine.example',
			),
		).toBe(
			'wss://machine.example/v1/dictation/sessions/session-1/ws?ticket=secret',
		);
	});

	test('accepts a one-time ticket for a tunneled dictation session', async () => {
		const { ticket } = createDictationWebSocketTicket({
			sessionId: 'session-1',
			projectId: 'project-owner',
		});
		const response = await app().request(
			`https://machine.example/v1/dictation/sessions/session-1/ws?ticket=${ticket}`,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			sessionId: 'session-1',
			projectId: 'project-owner',
		});

		const replay = await app().request(
			`https://machine.example/v1/dictation/sessions/session-1/ws?ticket=${ticket}`,
		);
		expect(replay.status).toBe(401);
	});

	test('rejects tickets for another session or a revoked share', async () => {
		const wrongSession = createDictationWebSocketTicket({
			sessionId: 'session-1',
		});
		const wrongResponse = await app().request(
			`https://machine.example/v1/dictation/sessions/session-2/ws?ticket=${wrongSession.ticket}`,
		);
		expect(wrongResponse.status).toBe(401);

		const share = createTunnelShare('project-share', 'https://machine.example');
		const revoked = createDictationWebSocketTicket({
			sessionId: 'session-share',
			shareToken: share.token,
		});
		revokeTunnelShare(share.id);
		const revokedResponse = await app().request(
			`https://machine.example/v1/dictation/sessions/session-share/ws?ticket=${revoked.ticket}`,
		);
		expect(revokedResponse.status).toBe(401);
	});
});
