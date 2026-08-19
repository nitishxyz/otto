import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthCredentialStore } from '../packages/sdk/src/core/src/mcp/oauth/store.ts';
import { OttoOAuthProvider } from '../packages/sdk/src/core/src/mcp/oauth/provider.ts';
import {
	claimMCPAuthFlow,
	clearMCPAuthFlows,
	createMCPAuthFlow,
} from '../packages/server/src/routes/mcp/oauth-flows.ts';
import {
	startOAuthCallbackProxy,
	startOAuthLoopbackCallback,
} from '../packages/server/src/routes/oauth-callback-proxy.ts';

afterEach(() => clearMCPAuthFlows());

describe('MCP OAuth flows', () => {
	test('validates state and consumes each flow once', () => {
		const flow = createMCPAuthFlow({
			name: 'linear',
			projectRoot: '/tmp/project',
			authUrl: 'https://auth.example/authorize?state=expected-state',
			callbackUrl: 'http://localhost:8090/callback',
		});

		expect(flow.callbackUrl).toBe('http://localhost:8090/callback');
		expect(() => claimMCPAuthFlow(flow.flowId, 'wrong-state')).toThrow(
			'OAuth callback state mismatch',
		);
		expect(claimMCPAuthFlow(flow.flowId, 'expected-state')).toMatchObject({
			name: 'linear',
			projectRoot: '/tmp/project',
		});
		expect(() => claimMCPAuthFlow(flow.flowId, 'expected-state')).toThrow(
			'OAuth flow expired or invalid',
		);
	});

	test('requires the authorization server state parameter', () => {
		expect(() =>
			createMCPAuthFlow({
				name: 'linear',
				projectRoot: '/tmp/project',
				authUrl: 'https://auth.example/authorize',
				callbackUrl: 'http://localhost:8090/callback',
			}),
		).toThrow('MCP OAuth server did not provide a state parameter');
	});
});

describe('OttoOAuthProvider callback ownership', () => {
	test('generates state for authorization requests', () => {
		const provider = new OttoOAuthProvider(
			'test-server',
			new OAuthCredentialStore(),
		);

		const first = provider.state();
		const second = provider.state();

		expect(first).toBeTruthy();
		expect(second).not.toBe(first);
	});

	test('records the authorization URL without binding the callback port', async () => {
		const probe = createServer();
		await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
		const address = probe.address();
		if (!address || typeof address === 'string')
			throw new Error('Missing port');
		const port = address.port;
		await new Promise<void>((resolve) => probe.close(() => resolve()));

		const provider = new OttoOAuthProvider(
			'test-server',
			new OAuthCredentialStore(),
			{ callbackPort: port },
		);
		await provider.redirectToAuthorization(
			new URL('https://auth.example/authorize?state=test'),
		);

		const listener = createServer();
		await new Promise<void>((resolve, reject) => {
			listener.once('error', reject);
			listener.listen(port, '127.0.0.1', resolve);
		});
		expect(provider.pendingAuthUrl).toContain('state=test');
		await new Promise<void>((resolve) => listener.close(() => resolve()));
	});

	test('clears a rejected refresh token and starts authorization again', async () => {
		const storePath = await mkdtemp(join(tmpdir(), 'otto-mcp-oauth-'));
		const store = new OAuthCredentialStore(storePath);
		const provider = new OttoOAuthProvider('test-server', store);
		await store.saveClientInfo('test-server', { client_id: 'test-client' });
		await store.saveTokens('test-server', {
			access_token: 'expired-access',
			refresh_token: 'expired-refresh',
		});

		try {
			const result = await auth(provider, {
				serverUrl: 'https://mcp.example/mcp',
				fetchFn: async (input) => {
					const url = new URL(input.toString());
					if (url.pathname.includes('oauth-protected-resource')) {
						return Response.json({
							resource: 'https://mcp.example/mcp',
							authorization_servers: ['https://auth.example'],
						});
					}
					if (url.pathname.includes('oauth-authorization-server')) {
						return Response.json({
							issuer: 'https://auth.example',
							authorization_endpoint: 'https://auth.example/authorize',
							token_endpoint: 'https://auth.example/token',
							response_types_supported: ['code'],
						});
					}
					if (url.pathname === '/token') {
						return Response.json(
							{
								error: 'invalid_grant',
								error_description: 'Invalid or expired refresh token',
							},
							{ status: 400 },
						);
					}
					return new Response(null, { status: 404 });
				},
			});

			expect(result).toBe('REDIRECT');
			expect(await store.loadTokens('test-server')).toBeUndefined();
			expect(await store.loadClientInfo('test-server')).toEqual({
				client_id: 'test-client',
			});
			expect(provider.pendingAuthUrl).toStartWith(
				'https://auth.example/authorize?',
			);
		} finally {
			await rm(storePath, { recursive: true, force: true });
		}
	});
});

describe('local OAuth callback proxy', () => {
	test('completes directly without a remote relay', async () => {
		const probe = createServer();
		await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
		const address = probe.address();
		if (!address || typeof address === 'string')
			throw new Error('Missing port');
		const callbackPort = address.port;
		await new Promise<void>((resolve) => probe.close(() => resolve()));
		let completed: unknown;

		await startOAuthLoopbackCallback({
			callbackUrl: `http://127.0.0.1:${callbackPort}/callback`,
			successMessage: 'Done',
			complete: async (result) => {
				completed = result;
			},
		});
		const response = await fetch(
			`http://127.0.0.1:${callbackPort}/callback?code=local-code&state=local-state`,
		);

		expect(response.status).toBe(200);
		expect(completed).toEqual({ code: 'local-code', state: 'local-state' });
	});

	test('relays a loopback callback to the target daemon', async () => {
		let relayed:
			| { authorization: string | null; path: string; body: unknown }
			| undefined;
		const remote = Bun.serve({
			port: 0,
			async fetch(request) {
				relayed = {
					authorization: request.headers.get('authorization'),
					path: new URL(request.url).pathname,
					body: await request.json(),
				};
				return Response.json({ ok: true });
			},
		});
		const probe = createServer();
		await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
		const address = probe.address();
		if (!address || typeof address === 'string')
			throw new Error('Missing port');
		const callbackPort = address.port;
		await new Promise<void>((resolve) => probe.close(() => resolve()));

		try {
			await startOAuthCallbackProxy(
				{
					authorizationUrl: 'https://auth.example/authorize',
					callbackUrl: `http://127.0.0.1:${callbackPort}/callback`,
					remoteBaseUrl: `http://127.0.0.1:${remote.port}`,
					remoteFlowId: 'flow-id',
					remoteToken: 'owner-token',
				},
				async () => false,
			);
			const response = await fetch(
				`http://127.0.0.1:${callbackPort}/callback?code=code-123&state=state-123`,
			);
			expect(response.status).toBe(200);
			expect(relayed).toEqual({
				authorization: 'Bearer owner-token',
				path: '/v1/mcp/oauth/flows/flow-id/complete',
				body: {
					code: 'code-123',
					state: 'state-123',
				},
			});
		} finally {
			remote.stop(true);
		}
	});
});
