import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	getAuth,
	removeAuth,
	setAuth,
} from '../packages/sdk/src/auth/src/index.ts';
import { getSecureAuthPath } from '../packages/sdk/src/config/src/paths.ts';
import { createAnthropicOAuthFetch } from '../packages/sdk/src/providers/src/anthropic-oauth-client.ts';
import type { OAuth } from '../packages/sdk/src/types/src/index.ts';

const originalHome = process.env.HOME;
const originalFetch = globalThis.fetch;
let home = '';
const stored: OAuth = {
	type: 'oauth',
	access: 'old-access',
	refresh: 'rotating-refresh',
	expires: 1,
};
const inferenceUrl = 'https://api.anthropic.com/v1/messages';

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), 'otto-anthropic-provider-'));
	process.env.HOME = home;
	await setAuth('anthropic', stored);
});
afterEach(async () => {
	globalThis.fetch = originalFetch;
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(home, { recursive: true, force: true });
});

function provider(project: string) {
	return createAnthropicOAuthFetch({
		authMode: 'managed',
		oauth: stored,
		projectRoot: join(home, project),
	});
}
function tokenResponse() {
	return Response.json({
		access_token: 'new-access',
		refresh_token: 'new-refresh',
		expires_in: 3600,
	});
}
function requestUrl(input: Parameters<typeof fetch>[0]) {
	return input instanceof Request ? input.url : input.toString();
}
function mockFetch(
	handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
	globalThis.fetch = ((input, init) =>
		handler(requestUrl(input), init)) as typeof fetch;
}
function gate() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe('Anthropic provider coordinated OAuth', () => {
	test('two projects sharing rotating credentials perform only one exchange', async () => {
		const exchanging = gate();
		const release = gate();
		let exchanges = 0;
		const authorization: Array<string | null> = [];
		mockFetch(async (url, init) => {
			if (!url.includes('/v1/messages')) {
				exchanges++;
				expect(
					new URLSearchParams(String(init?.body)).get('refresh_token'),
				).toBe('rotating-refresh');
				exchanging.resolve();
				await release.promise;
				return exchanges === 1
					? tokenResponse()
					: Response.json({ error: 'invalid_grant' }, { status: 400 });
			}
			authorization.push(new Headers(init?.headers).get('authorization'));
			return Response.json({ ok: true });
		});
		const first = provider('project-a')(inferenceUrl);
		const second = provider('project-b')(inferenceUrl);
		await exchanging.promise;
		await new Promise((resolve) => setTimeout(resolve, 20));
		release.resolve();
		const responses = await Promise.all([first, second]);
		expect(responses.every((response) => response.ok)).toBe(true);
		expect(exchanges).toBe(1);
		expect(authorization).toEqual(['Bearer new-access', 'Bearer new-access']);
		expect(await getAuth('anthropic')).toMatchObject({
			access: 'new-access',
			refresh: 'new-refresh',
		});
	});

	test('inference 401 forces refresh of a rejected unexpired token across projects', async () => {
		await setAuth('anthropic', { ...stored, expires: Date.now() + 3_600_000 });
		let exchanges = 0;
		let rejectedRequests = 0;
		const bothRejected = gate();
		mockFetch(async (url, init) => {
			if (!url.includes('/v1/messages')) {
				exchanges++;
				return tokenResponse();
			}
			if (
				new Headers(init?.headers).get('authorization') === 'Bearer old-access'
			) {
				rejectedRequests++;
				if (rejectedRequests === 2) bothRejected.resolve();
				await bothRejected.promise;
				return Response.json({ error: 'unauthorized' }, { status: 401 });
			}
			return Response.json({ ok: true });
		});
		const responses = await Promise.all([
			provider('project-a')(inferenceUrl),
			provider('project-b')(inferenceUrl),
		]);
		expect(rejectedRequests).toBe(2);
		expect(exchanges).toBe(1);
		expect(responses.every((response) => response.ok)).toBe(true);
	});

	test('logout during a forced refresh cannot resurrect auth or retry inference', async () => {
		await setAuth('anthropic', { ...stored, expires: Date.now() + 3_600_000 });
		const exchanging = gate();
		const release = gate();
		let inferenceCalls = 0;
		mockFetch(async (url) => {
			if (url.includes('/v1/messages')) {
				inferenceCalls++;
				return new Response('', { status: 401 });
			}
			exchanging.resolve();
			await release.promise;
			return tokenResponse();
		});
		const pending = provider('project-a')(inferenceUrl);
		const outcome = pending.then(
			() => null,
			(error: unknown) => error,
		);
		await exchanging.promise;
		await removeAuth('anthropic');
		release.resolve();
		expect(await outcome).toBeInstanceOf(Error);
		expect(((await outcome) as Error).message).toContain(
			'no longer configured',
		);
		expect(await getAuth('anthropic')).toBeUndefined();
		expect(inferenceCalls).toBe(1);
	});

	test('missing or replaced credentials never fall back to captured OAuth', async () => {
		const fetchProvider = provider('project-a');
		let requests = 0;
		mockFetch(async () => {
			requests++;
			return tokenResponse();
		});
		await removeAuth('anthropic');
		await expect(fetchProvider(inferenceUrl)).rejects.toThrow(
			'no longer configured',
		);
		await setAuth('anthropic', { type: 'api', key: 'replacement-key' });
		await expect(fetchProvider(inferenceUrl)).rejects.toThrow(
			'no longer configured',
		);
		expect(requests).toBe(0);
		expect(await getAuth('anthropic')).toEqual({
			type: 'api',
			key: 'replacement-key',
		});
	});

	test('malformed storage fails closed before exchange or inference', async () => {
		const path = getSecureAuthPath();
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, '{broken-json');
		let requests = 0;
		mockFetch(async () => {
			requests++;
			return tokenResponse();
		});
		await expect(provider('project-a')(inferenceUrl)).rejects.toThrow();
		expect(requests).toBe(0);
	});

	test('explicit permanent rejection is not retried and leaves stored auth intact', async () => {
		let exchanges = 0;
		mockFetch(async () => {
			exchanges++;
			return Response.json({ error: 'invalid_grant' }, { status: 400 });
		});
		await expect(provider('project-a')(inferenceUrl)).rejects.toThrow(
			'refresh token rejected',
		);
		expect(exchanges).toBe(1);
		expect(await getAuth('anthropic')).toEqual(stored);
	});

	test('generic 403 refresh failure remains transient and succeeds on bounded retry', async () => {
		let exchanges = 0;
		mockFetch(async (url) => {
			if (url.includes('/v1/messages')) return Response.json({ ok: true });
			exchanges++;
			return exchanges === 1
				? new Response('temporarily denied', { status: 403 })
				: tokenResponse();
		});
		expect((await provider('project-a')(inferenceUrl)).ok).toBe(true);
		expect(exchanges).toBe(2);
		expect(await getAuth('anthropic')).toMatchObject({ access: 'new-access' });
	});

	test('standalone explicit unexpired tokens work without stored auth while managed clients reject', async () => {
		await removeAuth('anthropic');
		const authorization: Array<string | null> = [];
		mockFetch(async (_url, init) => {
			authorization.push(new Headers(init?.headers).get('authorization'));
			return Response.json({ ok: true });
		});
		const standalone = createAnthropicOAuthFetch({
			oauth: {
				...stored,
				access: 'explicit-access',
				expires: Date.now() + 3_600_000,
			},
		});
		expect((await standalone(inferenceUrl)).ok).toBe(true);
		expect(authorization).toEqual(['Bearer explicit-access']);
		await expect(provider('managed-project')(inferenceUrl)).rejects.toThrow(
			'no longer configured',
		);
		expect(await getAuth('anthropic')).toBeUndefined();
	});

	test('standalone refresh is deduplicated and never persisted to auth storage', async () => {
		await removeAuth('anthropic');
		let exchanges = 0;
		const authorization: Array<string | null> = [];
		mockFetch(async (url, init) => {
			if (!url.includes('/v1/messages')) {
				exchanges++;
				await new Promise((resolve) => setTimeout(resolve, 10));
				return tokenResponse();
			}
			authorization.push(new Headers(init?.headers).get('authorization'));
			return Response.json({ ok: true });
		});
		const standalone = createAnthropicOAuthFetch({ oauth: stored });
		await Promise.all([standalone(inferenceUrl), standalone(inferenceUrl)]);
		expect(exchanges).toBe(1);
		expect(authorization).toEqual(['Bearer new-access', 'Bearer new-access']);
		expect(await getAuth('anthropic')).toBeUndefined();
	});

	test('SDK resolver preserves explicit standalone Anthropic OAuth', async () => {
		await removeAuth('anthropic');
		const authorization: Array<string | null> = [];
		mockFetch(async (_url, init) => {
			authorization.push(new Headers(init?.headers).get('authorization'));
			return Response.json(
				{
					error: {
						type: 'invalid_request_error',
						message: 'Mocked inference stop',
					},
				},
				{ status: 400 },
			);
		});
		const { resolveModel } = await import(
			'../packages/sdk/src/core/src/providers/resolver.ts'
		);
		const model = await resolveModel('anthropic', 'claude-sonnet-4-5', {
			oauth: {
				...stored,
				access: 'resolver-explicit-access',
				expires: Date.now() + 3_600_000,
			},
		});
		await expect(
			model.doGenerate({
				prompt: [
					{ role: 'user', content: [{ type: 'text', text: 'Explicit OAuth' }] },
				],
			}),
		).rejects.toThrow();
		expect(authorization).toEqual(['Bearer resolver-explicit-access']);
		expect(await getAuth('anthropic')).toBeUndefined();
	});
});
