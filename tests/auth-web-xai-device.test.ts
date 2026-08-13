import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAuth } from '@ottocode/sdk';
import { createApp } from '@ottocode/server';

describe('web xAI device OAuth flow', () => {
	let tempHome: string;
	let originalEnv: Record<string, string | undefined>;
	const originalFetch = globalThis.fetch;

	beforeEach(async () => {
		tempHome = await mkdtemp(join(tmpdir(), 'otto-auth-web-xai-'));
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
		globalThis.fetch = originalFetch;
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(tempHome, { recursive: true, force: true });
	});

	test('returns the user code and reports completion after xAI authorizes', async () => {
		globalThis.fetch = async (input, init) => {
			const request = new Request(input, init);
			if (request.url.endsWith('/oauth2/device/code')) {
				return Response.json({
					device_code: 'device-secret',
					user_code: 'ABCD-EFGH',
					verification_uri: 'https://accounts.x.ai/device',
					verification_uri_complete:
						'https://accounts.x.ai/device?user_code=ABCD-EFGH',
					expires_in: 60,
					interval: 0,
				});
			}
			return Response.json({
				access_token: 'access-token',
				refresh_token: 'refresh-token',
				expires_in: 3600,
				scope: 'grok-cli:access conversations:read workspaces:read',
			});
		};

		const app = createApp();
		const startResponse = await app.fetch(
			new Request('http://localhost/v1/auth/xai/device/start', {
				method: 'POST',
			}),
		);
		expect(startResponse.status).toBe(200);
		const start = (await startResponse.json()) as {
			sessionId: string;
			userCode: string;
			verificationUri: string;
		};
		expect(start).toMatchObject({
			userCode: 'ABCD-EFGH',
			verificationUri: 'https://accounts.x.ai/device?user_code=ABCD-EFGH',
		});

		await Bun.sleep(1100);
		const pollResponse = await app.fetch(
			new Request('http://localhost/v1/auth/xai/device/poll', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId: start.sessionId }),
			}),
		);
		expect(pollResponse.status).toBe(200);
		expect(await pollResponse.json()).toEqual({ status: 'complete' });

		const auth = await getAuth('xai');
		expect(auth).toMatchObject({
			type: 'oauth',
			access: 'access-token',
			refresh: 'refresh-token',
		});
	});
});
