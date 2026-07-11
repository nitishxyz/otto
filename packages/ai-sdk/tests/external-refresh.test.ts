import { describe, expect, test } from 'bun:test';
import { createOttoRouterFetch } from '../src/fetch.ts';
import type { OttoRouterAuth } from '../src/types.ts';

describe('external refresh coordinator hook', () => {
	test('uses refreshAccessToken instead of the built-in token exchange', async () => {
		let hookCalls = 0;
		let tokenEndpointCalls = 0;
		const auth: OttoRouterAuth = {
			accessToken: 'stale-access',
			expiresAt: Date.now() - 1_000,
			refreshAccessToken: async () => {
				hookCalls++;
				return {
					accessToken: 'coordinated-access',
					refreshToken: 'coordinated-refresh',
					expiresAt: Date.now() + 3600_000,
				};
			},
		};
		const ottorouterFetch = createOttoRouterFetch({
			auth,
			baseURL: 'https://ottorouter.test',
			fetch: async (input, init) => {
				const url = String(input);
				if (url.endsWith('/api/auth/oauth2/token')) {
					tokenEndpointCalls++;
					return Response.json({ access_token: 'wrong-path' });
				}
				const headers = new Headers(init?.headers);
				expect(headers.get('authorization')).toBe('Bearer coordinated-access');
				return Response.json({ ok: true });
			},
		});

		const response = await ottorouterFetch(
			'https://ottorouter.test/v1/messages',
			{ method: 'POST' },
		);

		expect(response.status).toBe(200);
		expect(hookCalls).toBe(1);
		expect(tokenEndpointCalls).toBe(0);
		expect(auth.accessToken).toBe('coordinated-access');
		expect(auth.refreshToken).toBe('coordinated-refresh');
	});

	test('passes the rejected access token to the hook on 401 retry', async () => {
		const staleTokens: Array<string | undefined> = [];
		let issued = 0;
		const auth: OttoRouterAuth = {
			accessToken: 'revoked-access',
			expiresAt: Date.now() + 3600_000,
			refreshAccessToken: async (options) => {
				staleTokens.push(options?.staleAccessToken);
				issued++;
				return {
					accessToken: `rotated-${issued}`,
					expiresAt: Date.now() + 3600_000,
				};
			},
		};
		const ottorouterFetch = createOttoRouterFetch({
			auth,
			baseURL: 'https://ottorouter.test',
			fetch: async (_input, init) => {
				const headers = new Headers(init?.headers);
				if (headers.get('authorization') === 'Bearer revoked-access') {
					return new Response('unauthorized', { status: 401 });
				}
				return Response.json({ ok: true });
			},
		});

		const response = await ottorouterFetch(
			'https://ottorouter.test/v1/messages',
			{ method: 'POST' },
		);

		expect(response.status).toBe(200);
		expect(staleTokens).toEqual(['revoked-access']);
	});
});
