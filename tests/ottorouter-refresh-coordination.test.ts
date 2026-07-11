import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setAuth, getAuth } from '../packages/sdk/src/auth/src/index.ts';
import { getFreshOttoRouterOAuth } from '../packages/sdk/src/auth/src/ottorouter-refresh.ts';
import type { OttoRouterOAuthTokens } from '../packages/sdk/src/auth/src/ottorouter-oauth.ts';

const originalHome = process.env.HOME;
const originalXdgState = process.env.XDG_STATE_HOME;
const originalAppData = process.env.APPDATA;

let tempHome: string;
let lockPath: string;

function tokens(overrides: Partial<OttoRouterOAuthTokens> = {}) {
	return {
		access: 'access-next',
		refresh: 'refresh-next',
		expires: Date.now() + 60 * 60 * 1000,
		...overrides,
	};
}

beforeEach(async () => {
	tempHome = await mkdtemp(join(tmpdir(), 'otto-refresh-test-'));
	process.env.HOME = tempHome;
	process.env.XDG_STATE_HOME = join(tempHome, 'state');
	process.env.APPDATA = join(tempHome, 'appdata');
	lockPath = join(tempHome, 'refresh.lock');
});

afterEach(async () => {
	process.env.HOME = originalHome;
	if (originalXdgState === undefined) delete process.env.XDG_STATE_HOME;
	else process.env.XDG_STATE_HOME = originalXdgState;
	if (originalAppData === undefined) delete process.env.APPDATA;
	else process.env.APPDATA = originalAppData;
	await rm(tempHome, { recursive: true, force: true });
});

describe('getFreshOttoRouterOAuth', () => {
	test('returns null when OttoRouter OAuth is not configured', async () => {
		const result = await getFreshOttoRouterOAuth({ lockPath });
		expect(result).toBeNull();
	});

	test('returns the persisted token untouched while it is still fresh', async () => {
		await setAuth('ottorouter', {
			type: 'oauth',
			access: 'access-fresh',
			refresh: 'refresh-1',
			expires: Date.now() + 60 * 60 * 1000,
		});
		let refreshCalls = 0;
		const result = await getFreshOttoRouterOAuth({
			lockPath,
			refreshFn: async () => {
				refreshCalls++;
				return tokens();
			},
		});
		expect(refreshCalls).toBe(0);
		expect(result?.access).toBe('access-fresh');
	});

	test('refreshes once for concurrent callers and persists rotation', async () => {
		await setAuth('ottorouter', {
			type: 'oauth',
			access: 'access-old',
			refresh: 'refresh-old',
			expires: Date.now() + 30_000,
		});
		let refreshCalls = 0;
		const refreshFn = async () => {
			refreshCalls++;
			await Bun.sleep(20);
			return tokens();
		};
		const [first, second, third] = await Promise.all([
			getFreshOttoRouterOAuth({ lockPath, refreshFn }),
			getFreshOttoRouterOAuth({ lockPath, refreshFn }),
			getFreshOttoRouterOAuth({ lockPath, refreshFn }),
		]);
		expect(refreshCalls).toBe(1);
		expect(first?.access).toBe('access-next');
		expect(second?.access).toBe('access-next');
		expect(third?.access).toBe('access-next');
		const persisted = await getAuth('ottorouter');
		expect(persisted).toMatchObject({
			type: 'oauth',
			access: 'access-next',
			refresh: 'refresh-next',
		});
	});

	test('recovers when another process already rotated the refresh token', async () => {
		await setAuth('ottorouter', {
			type: 'oauth',
			access: 'access-old',
			refresh: 'refresh-consumed',
			expires: Date.now() + 30_000,
		});
		let refreshCalls = 0;
		const result = await getFreshOttoRouterOAuth({
			lockPath,
			refreshFn: async (refresh) => {
				refreshCalls++;
				if (refresh === 'refresh-consumed') {
					await setAuth('ottorouter', {
						type: 'oauth',
						access: 'access-from-other-process',
						refresh: 'refresh-from-other-process',
						expires: Date.now() + 60 * 60 * 1000,
					});
					throw new Error(
						'OttoRouter OAuth token refresh failed: session not found',
					);
				}
				return tokens();
			},
		});
		expect(refreshCalls).toBe(1);
		expect(result?.access).toBe('access-from-other-process');
	});

	test('retries with the rotated refresh token when it is also near expiry', async () => {
		await setAuth('ottorouter', {
			type: 'oauth',
			access: 'access-old',
			refresh: 'refresh-consumed',
			expires: Date.now() + 30_000,
		});
		const seen: string[] = [];
		const result = await getFreshOttoRouterOAuth({
			lockPath,
			refreshFn: async (refresh) => {
				seen.push(refresh);
				if (refresh === 'refresh-consumed') {
					await setAuth('ottorouter', {
						type: 'oauth',
						access: 'access-stale-rotation',
						refresh: 'refresh-rotated',
						expires: Date.now() + 30_000,
					});
					throw new Error(
						'OttoRouter OAuth token refresh failed: session not found',
					);
				}
				return tokens();
			},
		});
		expect(seen).toEqual(['refresh-consumed', 'refresh-rotated']);
		expect(result?.access).toBe('access-next');
	});

	test('propagates refresh failures when no other process rotated the token', async () => {
		await setAuth('ottorouter', {
			type: 'oauth',
			access: 'access-old',
			refresh: 'refresh-dead',
			expires: Date.now() + 30_000,
		});
		await expect(
			getFreshOttoRouterOAuth({
				lockPath,
				refreshFn: async () => {
					throw new Error(
						'OttoRouter OAuth token refresh failed: session not found',
					);
				},
			}),
		).rejects.toThrow('session not found');
	});

	test('staleAccess forces one rotation of a token the backend rejected', async () => {
		await setAuth('ottorouter', {
			type: 'oauth',
			access: 'access-rejected',
			refresh: 'refresh-1',
			expires: Date.now() + 60 * 60 * 1000,
		});
		let refreshCalls = 0;
		const result = await getFreshOttoRouterOAuth({
			lockPath,
			staleAccess: 'access-rejected',
			refreshFn: async () => {
				refreshCalls++;
				return tokens();
			},
		});
		expect(refreshCalls).toBe(1);
		expect(result?.access).toBe('access-next');
	});

	test('staleAccess reuses a newer persisted token without another rotation', async () => {
		await setAuth('ottorouter', {
			type: 'oauth',
			access: 'access-already-rotated',
			refresh: 'refresh-2',
			expires: Date.now() + 60 * 60 * 1000,
		});
		let refreshCalls = 0;
		const result = await getFreshOttoRouterOAuth({
			lockPath,
			staleAccess: 'access-rejected',
			refreshFn: async () => {
				refreshCalls++;
				return tokens();
			},
		});
		expect(refreshCalls).toBe(0);
		expect(result?.access).toBe('access-already-rotated');
	});
});
