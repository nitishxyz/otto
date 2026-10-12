import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getFreshAnthropicOAuth } from '../packages/sdk/src/auth/src/anthropic-refresh.ts';
import { acquireFileLock } from '../packages/sdk/src/auth/src/file-lock.ts';
import {
	getAuth,
	removeAuth,
	setAuth,
} from '../packages/sdk/src/auth/src/index.ts';
import { getSecureAuthPath } from '../packages/sdk/src/config/src/paths.ts';
import type { OAuth } from '../packages/sdk/src/types/src/index.ts';

const originalEnv = {
	HOME: process.env.HOME,
	XDG_STATE_HOME: process.env.XDG_STATE_HOME,
	APPDATA: process.env.APPDATA,
};
let tempHome: string;
const expired: OAuth = {
	type: 'oauth',
	access: 'old-access',
	refresh: 'old-refresh',
	expires: 1,
};
function fresh() {
	return {
		access: 'new-access',
		refresh: 'new-refresh',
		expires: Date.now() + 3_600_000,
	};
}

beforeEach(async () => {
	tempHome = await mkdtemp(join(tmpdir(), 'otto-anthropic-refresh-'));
	process.env.HOME = tempHome;
	process.env.XDG_STATE_HOME = join(tempHome, 'state');
	process.env.APPDATA = join(tempHome, 'appdata');
	await setAuth('anthropic', expired);
});

afterEach(async () => {
	for (const [key, value] of Object.entries(originalEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await rm(tempHome, { recursive: true, force: true });
});

test('different project callers share one global refresh-token exchange', async () => {
	let calls = 0;
	const tokens = fresh();
	const refreshFn = async (token: string) => {
		expect(token).toBe(expired.refresh);
		calls++;
		await Bun.sleep(10);
		return tokens;
	};
	const results = await Promise.all([
		getFreshAnthropicOAuth({ projectRoot: '/test/project-a', refreshFn }),
		getFreshAnthropicOAuth({ projectRoot: '/test/project-b', refreshFn }),
	]);
	expect(calls).toBe(1);
	expect(results).toEqual([
		{ type: 'oauth', ...tokens },
		{ type: 'oauth', ...tokens },
	]);
	expect(await getAuth('anthropic')).toEqual(results[0] ?? undefined);
});

test('rereads rotated credentials after another process releases the refresh lock', async () => {
	const release = await acquireFileLock(
		`${getSecureAuthPath()}.anthropic-refresh.lock`,
	);
	let calls = 0;
	let settled = false;
	const pending = getFreshAnthropicOAuth({
		refreshFn: async () => {
			calls++;
			return fresh();
		},
	}).finally(() => {
		settled = true;
	});
	await Bun.sleep(20);
	expect(settled).toBe(false);
	const latest: OAuth = { type: 'oauth', ...fresh() };
	await setAuth('anthropic', latest);
	await release();
	expect(await pending).toEqual(latest);
	expect(calls).toBe(0);
});

test('refresh cannot resurrect a logout or clobber another provider', async () => {
	await setAuth('github', { type: 'api', key: 'other-key' });
	const result = await getFreshAnthropicOAuth({
		refreshFn: async () => {
			await removeAuth('anthropic');
			return fresh();
		},
	});
	expect(result).toBeNull();
	expect(await getAuth('anthropic')).toBeUndefined();
	expect(await getAuth('github')).toEqual({ type: 'api', key: 'other-key' });
});

test('refresh cannot overwrite a newer login', async () => {
	const latest: OAuth = {
		type: 'oauth',
		access: 'login-access',
		refresh: 'login-refresh',
		expires: Date.now() + 3_600_000,
	};
	const result = await getFreshAnthropicOAuth({
		refreshFn: async () => {
			await setAuth('anthropic', latest);
			return fresh();
		},
	});
	expect(result).toEqual(latest);
	expect(await getAuth('anthropic')).toEqual(latest);
});

test('401 stale access forces refresh even before expiry; different saved access is reused', async () => {
	const current: OAuth = { ...expired, expires: Date.now() + 3_600_000 };
	await setAuth('anthropic', current);
	let calls = 0;
	const refreshFn = async () => {
		calls++;
		return fresh();
	};
	const next = await getFreshAnthropicOAuth({
		staleAccess: current.access,
		refreshFn,
	});
	expect(calls).toBe(1);
	expect(next?.access).toBe('new-access');
	expect(
		await getFreshAnthropicOAuth({ staleAccess: current.access, refreshFn }),
	).toEqual(next);
	expect(calls).toBe(1);
});

test('invalid_grant recovers only when another writer actually rotated the credential', async () => {
	const latest: OAuth = { type: 'oauth', ...fresh() };
	let calls = 0;
	const result = await getFreshAnthropicOAuth({
		refreshFn: async () => {
			calls++;
			await setAuth('anthropic', latest);
			throw new Error('Claude OAuth refresh token rejected (invalid_grant).');
		},
	});
	expect(result).toEqual(latest);
	expect(calls).toBe(1);
});

test('revocation and transient failure both surface without deleting auth or retrying forever', async () => {
	for (const message of [
		'Claude OAuth refresh token rejected (invalid_grant).',
		'network unavailable',
	]) {
		let calls = 0;
		await expect(
			getFreshAnthropicOAuth({
				refreshFn: async () => {
					calls++;
					throw new Error(message);
				},
			}),
		).rejects.toThrow(message);
		expect(calls).toBe(1);
		expect(await getAuth('anthropic')).toEqual(expired);
	}
});
