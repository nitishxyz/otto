import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	getAuth,
	removeAuth,
	setAuth,
} from '../packages/sdk/src/auth/src/index.ts';
import { acquireFileLock } from '../packages/sdk/src/auth/src/file-lock.ts';
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
	test('treats second-based expiries as fresh', async () => {
		await setAuth('kimi', {
			type: 'oauth',
			access: 'access-fresh',
			refresh: 'refresh-old',
			expires: Math.floor(Date.now() / 1000) + 60 * 60,
		});
		let refreshCalls = 0;

		const result = await getFreshKimiOAuth({
			lockPath,
			refreshFn: async () => {
				refreshCalls++;
				return refreshedTokens();
			},
		});

		expect(refreshCalls).toBe(0);
		expect(result?.access).toBe('access-fresh');
	});

	test('re-reads auth after waiting for the cross-process lock', async () => {
		await setAuth('kimi', {
			type: 'oauth',
			access: 'access-old',
			refresh: 'refresh-old',
			expires: Date.now() + 30_000,
		});
		const release = await acquireFileLock(lockPath);
		let refreshCalls = 0;
		const pending = getFreshKimiOAuth({
			lockPath,
			refreshFn: async () => {
				refreshCalls++;
				return refreshedTokens();
			},
		});
		await Bun.sleep(10);
		await setAuth('kimi', {
			type: 'oauth',
			access: 'access-from-other-process',
			refresh: 'refresh-from-other-process',
			expires: Date.now() + 60 * 60_000,
		});
		await release();

		const result = await pending;
		expect(refreshCalls).toBe(0);
		expect(result?.access).toBe('access-from-other-process');
	});

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

	test('retries with a rotated refresh token that is still near expiry', async () => {
		await setAuth('kimi', {
			type: 'oauth',
			access: 'access-old',
			refresh: 'refresh-consumed',
			expires: Date.now() + 30_000,
		});
		const seen: string[] = [];

		const result = await getFreshKimiOAuth({
			lockPath,
			refreshFn: async (refresh) => {
				seen.push(refresh);
				if (refresh === 'refresh-consumed') {
					await setAuth('kimi', {
						type: 'oauth',
						access: 'access-stale-rotation',
						refresh: 'refresh-rotated',
						expires: Date.now() + 30_000,
					});
					throw new Error('Kimi OAuth refresh token rejected (invalid_grant)');
				}
				return refreshedTokens();
			},
		});

		expect(seen).toEqual(['refresh-consumed', 'refresh-rotated']);
		expect(result?.access).toBe('access-next');
	});

	test('does not overwrite a newer login that completes during refresh', async () => {
		await setAuth('kimi', {
			type: 'oauth',
			access: 'access-old',
			refresh: 'refresh-old',
			expires: Date.now() + 30_000,
		});

		const result = await getFreshKimiOAuth({
			lockPath,
			refreshFn: async () => {
				await setAuth('kimi', {
					type: 'oauth',
					access: 'access-new-login',
					refresh: 'refresh-new-login',
					expires: Date.now() + 60 * 60_000,
				});
				return refreshedTokens();
			},
		});

		expect(result?.access).toBe('access-new-login');
		expect(await getAuth('kimi')).toMatchObject({
			access: 'access-new-login',
			refresh: 'refresh-new-login',
		});
	});

	test('does not restore credentials removed during refresh', async () => {
		await setAuth('kimi', {
			type: 'oauth',
			access: 'access-old',
			refresh: 'refresh-old',
			expires: Date.now() + 30_000,
		});

		const result = await getFreshKimiOAuth({
			lockPath,
			refreshFn: async () => {
				await removeAuth('kimi');
				return refreshedTokens();
			},
		});

		expect(result).toBeNull();
		expect(await getAuth('kimi')).toBeUndefined();
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
