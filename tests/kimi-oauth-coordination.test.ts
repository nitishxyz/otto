import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAuth, setAuth } from '../packages/sdk/src/auth/src/index.ts';
import { getFreshKimiOAuth } from '../packages/sdk/src/auth/src/kimi-refresh.ts';
import { createKimiOAuthFetch } from '../packages/sdk/src/providers/src/kimi-oauth-fetch.ts';

const originalHome = process.env.HOME;
const originalFetch = globalThis.fetch;
let tempHome: string;
let lockPath: string;

beforeEach(async () => {
	tempHome = await mkdtemp(join(tmpdir(), 'otto-kimi-refresh-test-'));
	process.env.HOME = tempHome;
	lockPath = join(tempHome, 'refresh.lock');
});

afterEach(async () => {
	process.env.HOME = originalHome;
	globalThis.fetch = originalFetch;
	await rm(tempHome, { recursive: true, force: true });
});

function refreshedTokens() {
	return {
		access: 'access-next',
		refresh: 'refresh-next',
		expires: Date.now() + 60 * 60_000,
		scopes: 'coding',
	};
}

describe('Kimi OAuth refresh coordination', () => {
	test('refreshes once for concurrent callers and persists rotation', async () => {
		await setAuth('kimi', {
			type: 'oauth',
			access: 'access-old',
			refresh: 'refresh-old',
			expires: Date.now() + 30_000,
		});
		let refreshCalls = 0;
		const refreshFn = async () => {
			refreshCalls++;
			await Bun.sleep(20);
			return refreshedTokens();
		};

		const results = await Promise.all([
			getFreshKimiOAuth({ lockPath, refreshFn }),
			getFreshKimiOAuth({ lockPath, refreshFn }),
			getFreshKimiOAuth({ lockPath, refreshFn }),
		]);

		expect(refreshCalls).toBe(1);
		expect(results.map((result) => result?.access)).toEqual([
			'access-next',
			'access-next',
			'access-next',
		]);
		expect(await getAuth('kimi')).toMatchObject({
			type: 'oauth',
			access: 'access-next',
			refresh: 'refresh-next',
		});
	});

	test('recovers when another process already rotated the refresh token', async () => {
		await setAuth('kimi', {
			type: 'oauth',
			access: 'access-old',
			refresh: 'refresh-consumed',
			expires: Date.now() + 30_000,
		});

		const result = await getFreshKimiOAuth({
			lockPath,
			refreshFn: async (refresh) => {
				if (refresh !== 'refresh-consumed') return refreshedTokens();
				await setAuth('kimi', {
					type: 'oauth',
					access: 'access-from-other-process',
					refresh: 'refresh-from-other-process',
					expires: Date.now() + 60 * 60_000,
				});
				throw new Error('Kimi OAuth refresh token rejected (invalid_grant)');
			},
		});

		expect(result?.access).toBe('access-from-other-process');
	});

	test('refreshes and retries once when an access token gets a 401', async () => {
		const oauth = {
			type: 'oauth' as const,
			access: 'access-rejected',
			refresh: 'refresh-old',
			expires: Date.now() + 60 * 60_000,
		};
		await setAuth('kimi', oauth);

		let refreshCalls = 0;
		globalThis.fetch = (async () => {
			refreshCalls++;
			return new Response(
				JSON.stringify({
					access_token: 'access-next',
					refresh_token: 'refresh-next',
					expires_in: 3600,
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		}) as typeof fetch;

		const seenAuthorization: string[] = [];
		const baseFetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const authorization =
				new Headers(init?.headers).get('Authorization') ?? '';
			seenAuthorization.push(authorization);
			return authorization === 'Bearer access-next'
				? new Response('ok', { status: 200 })
				: new Response('unauthorized', { status: 401 });
		}) as typeof fetch;
		const oauthFetch = createKimiOAuthFetch(oauth, undefined, baseFetch);

		const response = await oauthFetch(
			'https://api.kimi.com/coding/v1/chat/completions',
		);

		expect(response.status).toBe(200);
		expect(refreshCalls).toBe(1);
		expect(seenAuthorization).toEqual([
			'Bearer access-rejected',
			'Bearer access-next',
		]);
		expect(await getAuth('kimi')).toMatchObject({
			access: 'access-next',
			refresh: 'refresh-next',
		});
	});
});
