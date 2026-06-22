import { afterEach, describe, expect, it } from 'bun:test';
import { refreshToken } from '../packages/sdk/src/auth/src/oauth.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('refreshToken', () => {
	it('refreshes Claude OAuth tokens with form-encoded body', async () => {
		let capturedUrl = '';
		let capturedBody = '';
		let capturedHeaders: HeadersInit | undefined;
		globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
			capturedUrl = String(url);
			capturedBody = String(init?.body ?? '');
			capturedHeaders = init?.headers;
			return new Response(
				JSON.stringify({
					access_token: 'new-access',
					refresh_token: 'new-refresh',
					expires_in: 3600,
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		}) as typeof fetch;

		const before = Date.now();
		const tokens = await refreshToken('old-refresh');

		expect(capturedUrl).toBe('https://console.anthropic.com/v1/oauth/token');
		expect(capturedHeaders).toMatchObject({
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json, text/plain, */*',
		});
		const params = new URLSearchParams(capturedBody);
		expect(params.get('grant_type')).toBe('refresh_token');
		expect(params.get('refresh_token')).toBe('old-refresh');
		expect(params.get('client_id')).toBe(
			'9d1c250a-e61b-44d9-88ed-5944d1962f5e',
		);
		expect(tokens.access).toBe('new-access');
		expect(tokens.refresh).toBe('new-refresh');
		expect(tokens.expires).toBeGreaterThanOrEqual(before + 3_600_000);
		expect(tokens.expires).toBeLessThanOrEqual(Date.now() + 3_600_000);
	});

	it('keeps the old Claude refresh token when the server omits rotation', async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({ access_token: 'new-access', expires_in: 3600 }),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			)) as typeof fetch;

		const tokens = await refreshToken('old-refresh');
		expect(tokens.refresh).toBe('old-refresh');
	});

	it('surfaces a re-login hint when Claude rejects the refresh token', async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					error: 'invalid_grant',
					error_description: 'refresh token expired',
				}),
				{ status: 401, headers: { 'Content-Type': 'application/json' } },
			)) as typeof fetch;

		await expect(refreshToken('dead-refresh')).rejects.toThrow(
			/refresh token rejected.*otto auth login anthropic/,
		);
	});
});
