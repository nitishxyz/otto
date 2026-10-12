import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';

let root = '';
const originalHome = process.env.HOME;
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const authorizations: Array<string | null> = [];

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'otto-harness-title-'));
	process.env.HOME = root;
	process.env.OPENAI_API_KEY = 'env-key';
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		authorizations.push(new Headers(init?.headers).get('authorization'));
		// Keep the active title busy so the others queue behind it.
		await new Promise((resolve) => setTimeout(resolve, 20));
		return Response.json(
			{ error: { message: 'mocked', type: 'invalid_request_error' } },
			{ status: 400 },
		);
	}) as typeof fetch;
	await mkdir(join(root, '.otto'), { recursive: true });
	await writeFile(
		join(root, '.otto', 'config.json'),
		JSON.stringify({
			memory: { enabled: false },
			defaults: { provider: 'openai', model: 'gpt-4o-mini', agent: 'build' },
		}),
	);
});

afterAll(async () => {
	globalThis.fetch = originalFetch;
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
	else process.env.OPENAI_API_KEY = originalKey;
	await rm(root, { recursive: true, force: true });
});

describe('queued title generation credentials', () => {
	test('each queued title uses the credentials of the request that scheduled it', async () => {
		const { triggerDeferredTitleGeneration } = await import(
			'../packages/server/src/runtime/message/title-generation.ts'
		);
		const { withRequestCredentials, getRequestApiKey } = await import(
			'../packages/server/src/runtime/provider/credentials.ts'
		);
		const cfg = await loadConfig(root);
		const db = await getDb(root);

		const createSession = async (text: string) => {
			const sessionId = crypto.randomUUID();
			const messageId = crypto.randomUUID();
			await db.insert(sessions).values({
				id: sessionId,
				agent: 'build',
				provider: 'openai',
				model: 'gpt-4o-mini',
				projectPath: root,
				createdAt: Date.now(),
			});
			await db.insert(messages).values({
				id: messageId,
				sessionId,
				role: 'user',
				status: 'complete',
				agent: 'build',
				provider: 'openai',
				model: 'gpt-4o-mini',
				createdAt: Date.now(),
			});
			await db.insert(messageParts).values({
				id: crypto.randomUUID(),
				messageId,
				index: 0,
				type: 'text',
				content: JSON.stringify({ text }),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-4o-mini',
			});
			return sessionId;
		};
		const [a, b, c] = await Promise.all([
			createSession('first title'),
			createSession('second title'),
			createSession('third title'),
		]);

		await withRequestCredentials({ openai: { apiKey: 'key-A' } }, () =>
			triggerDeferredTitleGeneration({ cfg, db, sessionId: a }),
		);
		await withRequestCredentials({ openai: { apiKey: 'key-B' } }, () =>
			triggerDeferredTitleGeneration({ cfg, db, sessionId: b }),
		);
		// Scheduled with no request credentials: must not inherit key-B.
		await triggerDeferredTitleGeneration({ cfg, db, sessionId: c });

		for (let n = 0; n < 300 && authorizations.length < 3; n++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(authorizations).toEqual([
			'Bearer key-A',
			'Bearer key-B',
			'Bearer env-key',
		]);
		expect(getRequestApiKey('openai')).toBeUndefined();
	});
});
