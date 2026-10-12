import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	getAllAuth,
	getAuth,
	setAuth,
} from '../packages/sdk/src/auth/src/index.ts';
import { refreshToken } from '../packages/sdk/src/auth/src/oauth.ts';
import { getSecureAuthPath } from '../packages/sdk/src/config/src/paths.ts';

const originalEnv = {
	HOME: process.env.HOME,
	XDG_STATE_HOME: process.env.XDG_STATE_HOME,
	APPDATA: process.env.APPDATA,
};
const originalFetch = globalThis.fetch;
let tempHome: string;

beforeEach(async () => {
	tempHome = await mkdtemp(join(tmpdir(), 'otto-anthropic-auth-'));
	process.env.HOME = tempHome;
	process.env.XDG_STATE_HOME = join(tempHome, 'state');
	process.env.APPDATA = join(tempHome, 'appdata');
});

afterEach(async () => {
	globalThis.fetch = originalFetch;
	for (const [key, value] of Object.entries(originalEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await rm(tempHome, { recursive: true, force: true });
});

test('missing auth is empty, but malformed auth must not masquerade as logout', async () => {
	expect(await getAllAuth()).toEqual({});
	await setAuth('anthropic', {
		type: 'oauth',
		access: 'test-access',
		refresh: 'test-refresh',
		expires: 1,
	});
	const path = getSecureAuthPath();
	const malformed = '{"anthropic":';
	await writeFile(path, malformed);
	await expect(getAllAuth()).rejects.toThrow();
	await expect(
		setAuth('github', { type: 'api', key: 'test-key' }),
	).rejects.toThrow();
	expect(await readFile(path, 'utf8')).toBe(malformed);
});

test('non-object auth cannot be silently replaced during another provider login', async () => {
	await setAuth('anthropic', { type: 'api', key: 'test-key' });
	const path = getSecureAuthPath();
	await writeFile(path, '[]');
	await expect(
		setAuth('github', { type: 'api', key: 'test-key' }),
	).rejects.toThrow();
	expect(await readFile(path, 'utf8')).toBe('[]');
});

test('proxy HTTP 403 is a refresh failure, not proof the refresh token was revoked', async () => {
	globalThis.fetch = Object.assign(
		async () => new Response('Temporary policy block', { status: 403 }),
		{ preconnect: originalFetch.preconnect },
	);
	await expect(refreshToken('test-refresh')).rejects.toThrow(
		'token refresh failed',
	);
});

test('server failures remain transient even if their body includes invalid_grant', async () => {
	globalThis.fetch = Object.assign(
		async () =>
			new Response(JSON.stringify({ error: 'invalid_grant' }), {
				status: 503,
			}),
		{ preconnect: originalFetch.preconnect },
	);
	await expect(refreshToken('test-refresh')).rejects.toThrow(
		'token refresh failed',
	);
});

test('actual invalid_grant stays visible and does not delete stored credentials', async () => {
	const oauth = {
		type: 'oauth' as const,
		access: 'test-access',
		refresh: 'test-refresh',
		expires: 1,
	};
	await setAuth('anthropic', oauth);
	globalThis.fetch = Object.assign(
		async () =>
			new Response(JSON.stringify({ error: 'invalid_grant' }), {
				status: 400,
			}),
		{ preconnect: originalFetch.preconnect },
	);
	await expect(refreshToken(oauth.refresh)).rejects.toThrow(
		'refresh token rejected',
	);
	expect(await getAuth('anthropic')).toEqual(oauth);
});
