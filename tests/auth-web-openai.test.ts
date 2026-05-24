import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAuth } from '@ottocode/sdk';
import { createApp } from '@ottocode/server';

function createMockAccessToken(accountId: string): string {
	const payload = Buffer.from(
		JSON.stringify({
			'https://api.openai.com/auth': {
				chatgpt_account_id: accountId,
			},
		}),
	).toString('base64url');
	return `header.${payload}.signature`;
}

async function waitForOpenAIOAuth() {
	for (let attempt = 0; attempt < 20; attempt++) {
		const auth = await getAuth('openai');
		if (auth?.type === 'oauth') return auth;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return getAuth('openai');
}

describe('web OpenAI OAuth flow', () => {
	let tempHome: string;
	let originalEnv: Record<string, string | undefined>;

	beforeEach(async () => {
		tempHome = await mkdtemp(join(tmpdir(), 'otto-auth-web-openai-'));
		originalEnv = {
			HOME: process.env.HOME,
			XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
			XDG_STATE_HOME: process.env.XDG_STATE_HOME,
		};
		process.env.HOME = tempHome;
		process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
		process.env.XDG_STATE_HOME = join(tempHome, '.state');
	});

	afterEach(async () => {
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(tempHome, { recursive: true, force: true });
	});

	test('uses the Codex loopback callback and persists OAuth tokens on callback', async () => {
		const app = createApp();
		const originalFetch = globalThis.fetch;
		const mockedFetch: typeof fetch = async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url === 'https://auth.openai.com/oauth/token') {
				return new Response(
					JSON.stringify({
						id_token: 'id-token',
						access_token: createMockAccessToken('acct_test_123'),
						refresh_token: 'refresh-token',
						expires_in: 3600,
					}),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					},
				);
			}
			return originalFetch(input, init);
		};
		globalThis.fetch = mockedFetch;

		let callbackUrl: string | undefined;

		try {
			const startResponse = await app.fetch(
				new Request('http://localhost/v1/auth/openai/oauth/start', {
					headers: {
						host: 'otto.test',
						'x-forwarded-proto': 'https',
					},
				}),
			);

			expect(startResponse.status).toBe(302);

			const location = startResponse.headers.get('Location');
			expect(location).toBeTruthy();
			const authUrl = new URL(location as string);
			expect(authUrl.origin).toBe('https://auth.openai.com');
			expect(authUrl.searchParams.get('redirect_uri')).toBe(
				'http://localhost:1455/auth/callback',
			);
			const state = authUrl.searchParams.get('state');
			expect(state).toBeTruthy();

			callbackUrl = `http://127.0.0.1:1455/auth/callback?code=test-code&state=${encodeURIComponent(
				state as string,
			)}`;
			const callbackResponse = await fetch(callbackUrl);

			expect(callbackResponse.status).toBe(200);
			expect(await callbackResponse.text()).toContain('Connected!');

			const auth = await waitForOpenAIOAuth();
			expect(auth?.type).toBe('oauth');
			if (auth?.type === 'oauth') {
				expect(auth.refresh).toBe('refresh-token');
				expect(auth.idToken).toBe('id-token');
				expect(auth.accountId).toBe('acct_test_123');
			}
		} finally {
			if (callbackUrl) {
				await fetch(callbackUrl).catch(() => undefined);
			}
			globalThis.fetch = originalFetch;
		}
	});
});
