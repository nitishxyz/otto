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
});
