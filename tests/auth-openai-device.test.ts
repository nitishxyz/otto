import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAuth } from '@ottocode/sdk';
import { createApp } from '@ottocode/server';
import { openAIDeviceSessions } from '../packages/server/src/routes/auth/state.ts';

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

describe('OpenAI device auth flow', () => {
	let tempHome: string;
	let originalEnv: Record<string, string | undefined>;
	let originalFetch: typeof fetch;

	beforeEach(async () => {
		tempHome = await mkdtemp(join(tmpdir(), 'otto-auth-openai-device-'));
		originalEnv = {
			HOME: process.env.HOME,
			XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
			XDG_STATE_HOME: process.env.XDG_STATE_HOME,
		};
		process.env.HOME = tempHome;
		process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
		process.env.XDG_STATE_HOME = join(tempHome, '.state');
		originalFetch = globalThis.fetch;
		openAIDeviceSessions.clear();
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		openAIDeviceSessions.clear();
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(tempHome, { recursive: true, force: true });
	});

	test('starts device flow and returns user code', async () => {
		globalThis.fetch = async (input) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url === 'https://auth.openai.com/api/accounts/deviceauth/usercode') {
				return Response.json({
					device_auth_id: 'device-auth-1',
					user_code: 'ABCD-EFGH',
					interval: '5',
				});
			}
			return originalFetch(input);
		};

		const app = createApp();
		const response = await app.request('/v1/auth/openai/device/start', {
			method: 'POST',
		});
		const json = (await response.json()) as {
			sessionId: string;
			userCode: string;
			verificationUri: string;
			interval: number;
		};

		expect(response.status).toBe(200);
		expect(json.sessionId).toBeTruthy();
		expect(json.userCode).toBe('ABCD-EFGH');
		expect(json.verificationUri).toBe('https://auth.openai.com/codex/device');
		expect(json.interval).toBe(5);
		expect(openAIDeviceSessions.has(json.sessionId)).toBe(true);
	});

	test('poll returns pending while user has not authorized', async () => {
		const sessionId = crypto.randomUUID();
		openAIDeviceSessions.set(sessionId, {
			deviceAuthId: 'device-auth-1',
			userCode: 'ABCD-EFGH',
			interval: 5,
			createdAt: Date.now(),
		});
		globalThis.fetch = async (input) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url === 'https://auth.openai.com/api/accounts/deviceauth/token') {
				return new Response('', { status: 403 });
			}
			return originalFetch(input);
		};

		const app = createApp();
		const response = await app.request('/v1/auth/openai/device/poll', {
			method: 'POST',
			body: JSON.stringify({ sessionId }),
			headers: { 'Content-Type': 'application/json' },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'pending' });
		expect(openAIDeviceSessions.has(sessionId)).toBe(true);
	});

	test('poll exchanges completed device authorization and stores OAuth tokens', async () => {
		const sessionId = crypto.randomUUID();
		openAIDeviceSessions.set(sessionId, {
			deviceAuthId: 'device-auth-1',
			userCode: 'ABCD-EFGH',
			interval: 5,
			createdAt: Date.now(),
		});
		globalThis.fetch = async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url === 'https://auth.openai.com/api/accounts/deviceauth/token') {
				return Response.json({
					authorization_code: 'authorization-code',
					code_challenge: 'code-challenge',
					code_verifier: 'code-verifier',
				});
			}
			if (url === 'https://auth.openai.com/oauth/token') {
				const body = String(init?.body ?? '');
				expect(body).toContain(
					'redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback',
				);
				return Response.json({
					id_token: 'id-token',
					access_token: createMockAccessToken('acct_device_123'),
					refresh_token: 'refresh-token',
					expires_in: 3600,
				});
			}
			return originalFetch(input, init);
		};

		const app = createApp();
		const response = await app.request('/v1/auth/openai/device/poll', {
			method: 'POST',
			body: JSON.stringify({ sessionId }),
			headers: { 'Content-Type': 'application/json' },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'complete' });
		expect(openAIDeviceSessions.has(sessionId)).toBe(false);
		const auth = await waitForOpenAIOAuth();
		expect(auth?.type).toBe('oauth');
		if (auth?.type === 'oauth') {
			expect(auth.refresh).toBe('refresh-token');
			expect(auth.idToken).toBe('id-token');
			expect(auth.accountId).toBe('acct_device_123');
		}
	});

	test('poll rejects invalid sessions', async () => {
		const app = createApp();
		const response = await app.request('/v1/auth/openai/device/poll', {
			method: 'POST',
			body: JSON.stringify({ sessionId: 'missing' }),
			headers: { 'Content-Type': 'application/json' },
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				message: 'Session expired or invalid',
				type: 'api_error',
				status: 400,
				details: {
					name: 'APIError',
					type: 'api_error',
					status: 400,
				},
			},
		});
	});
});
