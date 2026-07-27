import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSessionSecureInputRoute } from '../packages/server/src/routes/session-secure-input.ts';
import { getProjectManager } from '../packages/server/src/runtime/projects/manager.ts';
import { requestSecureInput } from '../packages/server/src/runtime/tools/secure-input.ts';

function createSecureInputApp() {
	const app = new OpenAPIHono();
	registerSessionSecureInputRoute(app);
	return app;
}

describe('session secure input routes', () => {
	let projectDir: string;
	let projectRoot: string;

	beforeAll(async () => {
		projectDir = await mkdtemp(join(tmpdir(), 'otto-secure-input-'));
		const runtime = await getProjectManager().openProject({
			path: projectDir,
		});
		projectRoot = runtime.root;
	});

	afterAll(async () => {
		await rm(projectDir, { recursive: true, force: true });
	});

	function projectUrl(path: string): string {
		return `http://localhost${path}?project=${encodeURIComponent(projectRoot)}`;
	}

	test('lists pending shell prompts that do not have a tool call id', async () => {
		const app = createSecureInputApp();
		const pendingValue = requestSecureInput({
			projectRoot,
			sessionId: 'session-1',
			messageId: 'message-1',
			prompt: 'Password:',
			timeoutMs: 10_000,
		});

		const listRes = await app.request(
			projectUrl('/v1/sessions/session-1/secure-input/pending'),
		);
		expect(listRes.status).toBe(200);
		const list = await listRes.json();
		expect(list.pending).toHaveLength(1);
		expect(list.pending[0].prompt).toBe('Password:');
		expect(list.pending[0].callId).toBeUndefined();
		expect(list.pending[0].inputKind).toBe('password');
		expect(list.pending[0].allowRemember).toBe(true);
		expect(list.pending[0].allowEmpty).toBe(false);

		const cancelRes = await app.request(
			projectUrl('/v1/sessions/session-1/secure-input'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					promptId: list.pending[0].promptId,
					cancelled: true,
				}),
			},
		);
		expect(cancelRes.status).toBe(200);
		expect(await pendingValue).toBeNull();
	});

	test('resolves submitted secure input values', async () => {
		const app = createSecureInputApp();
		const pendingValue = requestSecureInput({
			projectRoot,
			sessionId: 'session-2',
			messageId: 'message-2',
			callId: 'call-2',
			prompt: '[sudo] password for user:',
			timeoutMs: 10_000,
		});

		const listRes = await app.request(
			projectUrl('/v1/sessions/session-2/secure-input/pending'),
		);
		const list = await listRes.json();
		const promptId = list.pending[0].promptId;

		const resolveRes = await app.request(
			projectUrl('/v1/sessions/session-2/secure-input'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ promptId, value: 'secret' }),
			},
		);

		expect(resolveRes.status).toBe(200);
		expect(await resolveRes.json()).toEqual({
			ok: true,
			promptId,
			cancelled: false,
		});
		expect(await pendingValue).toBe('secret');
	});

	test('reuses remembered input from the in-memory server cache', async () => {
		const app = createSecureInputApp();
		const cacheKey = `test-cache-${crypto.randomUUID()}`;
		const firstValue = requestSecureInput({
			projectRoot,
			sessionId: 'session-cache',
			messageId: 'message-cache-1',
			prompt: 'Password for cache test:',
			cacheKey,
			timeoutMs: 10_000,
		});

		const listRes = await app.request(
			projectUrl('/v1/sessions/session-cache/secure-input/pending'),
		);
		const list = await listRes.json();
		const promptId = list.pending[0].promptId;
		const resolveRes = await app.request(
			projectUrl('/v1/sessions/session-cache/secure-input'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					promptId,
					value: 'remembered-secret',
					remember: true,
				}),
			},
		);

		expect(resolveRes.status).toBe(200);
		expect(await firstValue).toBe('remembered-secret');
		expect(
			await requestSecureInput({
				projectRoot,
				sessionId: 'session-cache',
				messageId: 'message-cache-2',
				prompt: 'Password for cache test:',
				cacheKey,
			}),
		).toBe('remembered-secret');

		const pendingRes = await app.request(
			projectUrl('/v1/sessions/session-cache/secure-input/pending'),
		);
		expect((await pendingRes.json()).pending).toHaveLength(0);
	});

	test('expires remembered input after its cache TTL', async () => {
		const app = createSecureInputApp();
		const cacheKey = `test-expiry-${crypto.randomUUID()}`;
		const firstValue = requestSecureInput({
			projectRoot,
			sessionId: 'session-expiry',
			messageId: 'message-expiry-1',
			prompt: 'Password for expiry test:',
			cacheKey,
			cacheTtlMs: 5,
			timeoutMs: 10_000,
		});
		const firstList = await (
			await app.request(
				projectUrl('/v1/sessions/session-expiry/secure-input/pending'),
			)
		).json();
		await app.request(projectUrl('/v1/sessions/session-expiry/secure-input'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				promptId: firstList.pending[0].promptId,
				value: 'short-lived-secret',
				remember: true,
			}),
		});
		expect(await firstValue).toBe('short-lived-secret');

		await Bun.sleep(10);
		const secondValue = requestSecureInput({
			projectRoot,
			sessionId: 'session-expiry',
			messageId: 'message-expiry-2',
			prompt: 'Password for expiry test:',
			cacheKey,
			timeoutMs: 10_000,
		});
		const secondList = await (
			await app.request(
				projectUrl('/v1/sessions/session-expiry/secure-input/pending'),
			)
		).json();
		expect(secondList.pending).toHaveLength(1);
		await app.request(projectUrl('/v1/sessions/session-expiry/secure-input'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				promptId: secondList.pending[0].promptId,
				cancelled: true,
			}),
		});
		expect(await secondValue).toBeNull();
	});

	test('bypasses a remembered value after authentication fails', async () => {
		const app = createSecureInputApp();
		const cacheKey = `test-retry-${crypto.randomUUID()}`;
		const firstValue = requestSecureInput({
			projectRoot,
			sessionId: 'session-retry',
			messageId: 'message-retry-1',
			prompt: 'Password for retry test:',
			cacheKey,
			timeoutMs: 10_000,
		});
		const firstList = await (
			await app.request(
				projectUrl('/v1/sessions/session-retry/secure-input/pending'),
			)
		).json();
		await app.request(projectUrl('/v1/sessions/session-retry/secure-input'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				promptId: firstList.pending[0].promptId,
				value: 'wrong-secret',
				remember: true,
			}),
		});
		expect(await firstValue).toBe('wrong-secret');

		const retryValue = requestSecureInput({
			projectRoot,
			sessionId: 'session-retry',
			messageId: 'message-retry-2',
			prompt: 'Password for retry test:',
			cacheKey,
			bypassCache: true,
			timeoutMs: 10_000,
		});
		const retryList = await (
			await app.request(
				projectUrl('/v1/sessions/session-retry/secure-input/pending'),
			)
		).json();
		expect(retryList.pending).toHaveLength(1);
		await app.request(projectUrl('/v1/sessions/session-retry/secure-input'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				promptId: retryList.pending[0].promptId,
				cancelled: true,
			}),
		});
		expect(await retryValue).toBeNull();
	});
});
