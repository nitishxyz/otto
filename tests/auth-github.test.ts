import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAuth } from '@ottocode/sdk';
import { createApp } from '@ottocode/server';
import { resolveClonePath } from '../packages/server/src/routes/auth/github-service.ts';
import { githubDeviceSessions } from '../packages/server/src/routes/auth/state.ts';

const originalFetch = globalThis.fetch;

describe('GitHub server integration', () => {
	let tempHome: string;
	let originalEnv: Record<string, string | undefined>;

	beforeEach(async () => {
		tempHome = await mkdtemp(join(tmpdir(), 'otto-auth-github-'));
		originalEnv = {
			HOME: process.env.HOME,
			XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
			XDG_STATE_HOME: process.env.XDG_STATE_HOME,
		};
		process.env.HOME = tempHome;
		process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
		process.env.XDG_STATE_HOME = join(tempHome, '.state');
		githubDeviceSessions.clear();
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		githubDeviceSessions.clear();
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(tempHome, { recursive: true, force: true });
	});

	test('completes device auth without returning the access token', async () => {
		globalThis.fetch = async (input) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url === 'https://github.com/login/device/code') {
				return Response.json({
					device_code: 'device-code',
					user_code: 'ABCD-EFGH',
					verification_uri: 'https://github.com/login/device',
					interval: 5,
					expires_in: 900,
				});
			}
			if (url === 'https://github.com/login/oauth/access_token') {
				return Response.json({ access_token: 'secret-token' });
			}
			if (url === 'https://api.github.com/user') {
				return Response.json({
					login: 'octocat',
					name: 'Octo Cat',
					avatar_url: 'https://avatars.example/octocat',
				});
			}
			throw new Error(`Unexpected request: ${url}`);
		};

		const app = createApp();
		const startResponse = await app.request('/v1/github/device/start', {
			method: 'POST',
		});
		const start = (await startResponse.json()) as { sessionId: string };
		const pollResponse = await app.request('/v1/github/device/poll', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId: start.sessionId }),
		});
		const poll = (await pollResponse.json()) as Record<string, unknown>;

		expect(startResponse.status).toBe(200);
		expect(pollResponse.status).toBe(200);
		expect(poll.status).toBe('complete');
		expect(poll.accessToken).toBeUndefined();
		expect(poll.user).toEqual({
			login: 'octocat',
			name: 'Octo Cat',
			avatarUrl: 'https://avatars.example/octocat',
		});
		const auth = await getAuth('github');
		expect(auth?.type === 'oauth' ? auth.access : null).toBe('secret-token');
	});

	test('lists repositories using server-owned credentials', async () => {
		const { setAuth } = await import('@ottocode/sdk');
		await setAuth('github', {
			type: 'oauth',
			access: 'secret-token',
			refresh: '',
			expires: 0,
		});
		globalThis.fetch = async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			expect(new Headers(init?.headers).get('Authorization')).toBe(
				'Bearer secret-token',
			);
			if (url.includes('/user/repos')) {
				return Response.json([
					{
						id: 1,
						name: 'otto',
						full_name: 'octocat/otto',
						clone_url: 'https://github.com/octocat/otto.git',
						private: true,
						description: 'Test repository',
					},
				]);
			}
			throw new Error(`Unexpected request: ${url}`);
		};

		const response = await createApp().request('/v1/github/repos?page=1');
		const json = (await response.json()) as {
			repos: Array<{ fullName: string; cloneUrl: string }>;
		};

		expect(response.status).toBe(200);
		expect(json.repos).toEqual([
			{
				id: 1,
				name: 'otto',
				fullName: 'octocat/otto',
				cloneUrl: 'https://github.com/octocat/otto.git',
				private: true,
				description: 'Test repository',
			},
		]);
	});

	test('restricts clone destinations to the user Projects directory', () => {
		expect(resolveClonePath('~/Projects/otto')).toBe(
			join(tempHome, 'Projects', 'otto'),
		);
		expect(resolveClonePath('~/Projects')).toBeNull();
		expect(resolveClonePath('~/Desktop/otto')).toBeNull();
		expect(resolveClonePath('/tmp/otto')).toBeNull();
		expect(resolveClonePath('~/Projects/../secret')).toBeNull();
	});
});
