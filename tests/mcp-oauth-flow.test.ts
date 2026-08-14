import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
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
