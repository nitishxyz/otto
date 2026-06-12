import { afterEach, describe, expect, it } from 'bun:test';
import { refreshKimiToken } from '../packages/sdk/src/auth/src/kimi-oauth.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('refreshKimiToken', () => {
	it('sends refresh_token grant and normalizes the response', async () => {
		let capturedUrl = '';
		let capturedBody = '';
		globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
			capturedUrl = String(url);
			capturedBody = String(init?.body ?? '');
			return new Response(
				JSON.stringify({
					access_token: 'new-access',
					refresh_token: 'new-refresh',
					expires_in: 900,
					scope: 'coding',
					token_type: 'bearer',
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		}) as typeof fetch;

		const before = Date.now();
		const tokens = await refreshKimiToken('old-refresh');

		expect(capturedUrl).toBe('https://auth.kimi.com/api/oauth/token');
		const params = new URLSearchParams(capturedBody);
		expect(params.get('grant_type')).toBe('refresh_token');
		expect(params.get('refresh_token')).toBe('old-refresh');
		expect(params.get('client_id')).toBe(
			'17e5f671-d194-4dfb-9706-5516cb48c098',
		);
		expect(tokens.access).toBe('new-access');
		expect(tokens.refresh).toBe('new-refresh');
		expect(tokens.scopes).toBe('coding');
		expect(tokens.expires).toBeGreaterThanOrEqual(before + 900_000);
		expect(tokens.expires).toBeLessThanOrEqual(Date.now() + 900_000);
	});

	it('keeps the old refresh token when the server omits rotation', async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({ access_token: 'new-access', expires_in: 900 }),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			)) as typeof fetch;

		const tokens = await refreshKimiToken('old-refresh');
		expect(tokens.refresh).toBe('old-refresh');
	});

	it('throws a re-login error on 401', async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({ error_description: 'refresh token revoked' }),
				{ status: 401, headers: { 'Content-Type': 'application/json' } },
			)) as typeof fetch;

		await expect(refreshKimiToken('dead-refresh')).rejects.toThrow(
			/refresh token rejected.*otto auth login kimi/,
		);
	});
});
