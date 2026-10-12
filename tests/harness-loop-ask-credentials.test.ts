import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import type { AskServerRequest } from '../packages/server/src/runtime/ask/service.ts';

let root = '';
const originalHome = process.env.HOME;
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const requests: Array<{
	authorization: string | null;
	body: string;
	url: string;
}> = [];
let ask: typeof import('../packages/server/src/runtime/ask/service.ts');
let credentials: typeof import('../packages/server/src/runtime/provider/credentials.ts');
let runner: typeof import('../packages/server/src/runtime/agent/runner.ts');
let queue: typeof import('../packages/server/src/runtime/session/queue.ts');
const published: unknown[] = [];
let unsubscribe = () => {};

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'otto-ask-credentials-'));
	process.env.HOME = root;
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		const body = String(init?.body ?? '');
		requests.push({
			url: _input instanceof Request ? _input.url : String(_input),
			authorization: new Headers(init?.headers).get('authorization'),
			body,
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		if (body.includes('Fail mocked inference'))
			return Response.json(
				{
					error: {
						message: 'Mocked inference rejected',
						type: 'invalid_request_error',
					},
				},
				{ status: 400 },
			);
		if (JSON.parse(body).stream) {
			const events = [
				{
					type: 'response.output_item.added',
					output_index: 0,
					item: { type: 'message', id: 'message' },
				},
				{
					type: 'response.output_text.delta',
					item_id: 'message',
					delta: 'Scoped response complete.',
				},
				{
					type: 'response.output_item.done',
					output_index: 0,
					item: { type: 'message', id: 'message' },
				},
				{
					type: 'response.completed',
					response: { usage: { input_tokens: 10, output_tokens: 5 } },
				},
			];
			return new Response(
				events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
				{ headers: { 'content-type': 'text/event-stream' } },
			);
		}
		return Response.json({
			id: 'mock',
			object: 'chat.completion',
			created: 1,
			model: 'gpt-4o-mini',
			choices: [
				{
					index: 0,
					message: { role: 'assistant', content: 'Scoped response complete.' },
					finish_reason: 'stop',
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		});
	}) as typeof fetch;
	ask = await import('../packages/server/src/runtime/ask/service.ts');
	credentials = await import(
		'../packages/server/src/runtime/provider/credentials.ts'
	);
	runner = await import('../packages/server/src/runtime/agent/runner.ts');
	queue = await import('../packages/server/src/runtime/session/queue.ts');
	const bus = await import('../packages/server/src/events/bus.ts');
	unsubscribe = bus.subscribeDesktopEvents((event) => {
		published.push(event);
	});
	for (const project of ['a', 'b']) {
		await mkdir(join(root, project, '.otto'), { recursive: true });
		await writeFile(
			join(root, project, '.otto', 'config.json'),
			JSON.stringify({
				memory: { enabled: false },
				defaults: { provider: 'openai', model: 'gpt-4o-mini', agent: 'build' },
			}),
		);
	}
});

afterAll(async () => {
	unsubscribe();
	globalThis.fetch = originalFetch;
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(root, { recursive: true, force: true });
});

function request(project: string, key: string): AskServerRequest {
	return {
		projectRoot: join(root, project),
		prompt: `Request from project ${project}`,
		provider: 'openai',
		model: 'gpt-4o-mini',
		agent: 'build',
		agentPrompt: 'Answer directly.',
		tools: { firstClass: [] },
		credentials: { openai: { apiKey: key } },
	};
}
async function waitForMessage(project: string, messageId: string) {
	const db = await getDb(join(root, project));
	for (let n = 0; n < 200; n++) {
		const [row] = await db
			.select()
			.from(messages)
			.where(eq(messages.id, messageId));
		if (row?.status !== 'pending') return row;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error('Scripted ask did not finish');
}

describe('request-scoped ask credentials', () => {
	test('concurrent projects reach mocked inference with distinct keys, never env or persisted content', async () => {
		const [a, b] = await Promise.all([
			ask.handleAskRequest(request('a', 'request-secret-a')),
			ask.handleAskRequest(request('b', 'request-secret-b')),
		]);
		const [rowA, rowB] = await Promise.all([
			waitForMessage('a', a.assistantMessageId),
			waitForMessage('b', b.assistantMessageId),
		]);
		expect(rowA?.error).toBeNull();
		expect(rowA?.status).toBe('complete');
		expect(rowB?.status).toBe('complete');
		for (const project of ['a', 'b']) {
			const matched = requests.filter((entry) =>
				entry.body.includes(`Request from project ${project}`),
			);
			expect(matched.length).toBeGreaterThan(0);
			expect(
				matched.every(
					(entry) => entry.authorization === `Bearer request-secret-${project}`,
				),
			).toBe(true);
			const db = await getDb(join(root, project));
			expect(JSON.stringify(await db.select().from(messages))).not.toContain(
				'request-secret',
			);
			expect(
				JSON.stringify(await db.select().from(messageParts)),
			).not.toContain('request-secret');
		}
		expect(process.env.OPENAI_API_KEY).toBe(originalKey);
		expect(credentials.getRequestApiKey('openai')).toBeUndefined();
		expect(JSON.stringify(published)).not.toContain('request-secret');
	});
	test('failed mocked inference cannot leak its credential into a later config-key request', async () => {
		const failed = await ask.handleAskRequest({
			...request('a', 'failed-provider-secret'),
			prompt: 'Fail mocked inference',
		});
		expect((await waitForMessage('a', failed.assistantMessageId))?.status).toBe(
			'error',
		);
		const next = await ask.handleAskRequest({
			...request('a', 'unused'),
			credentials: undefined,
			config: {
				provider: 'openai',
				model: 'gpt-4o-mini',
				apiKey: 'config-only-secret',
			},
			prompt: 'Config credential after inference failure',
		});
		expect((await waitForMessage('a', next.assistantMessageId))?.status).toBe(
			'complete',
		);
		const matched = requests.filter((entry) =>
			entry.body.includes('Config credential after inference failure'),
		);
		expect(matched.length).toBeGreaterThan(0);
		expect(
			matched.every(
				(entry) => entry.authorization === 'Bearer config-only-secret',
			),
		).toBe(true);
		expect(process.env.OPENAI_API_KEY).toBe(originalKey);
		expect(credentials.getRequestApiKey('openai')).toBeUndefined();
		expect(JSON.stringify(published)).not.toContain('failed-provider-secret');
		expect(JSON.stringify(published)).not.toContain('config-only-secret');
	});

	test('failed request cleans up scope and cannot replace the next request key', async () => {
		await expect(
			ask.handleAskRequest({
				...request('a', 'failed-secret'),
				sessionId: 'missing-session',
			}),
		).rejects.toThrow('Session not found');
		expect(credentials.getRequestApiKey('openai')).toBeUndefined();
		expect(process.env.OPENAI_API_KEY).toBe(originalKey);
		const result = await ask.handleAskRequest({
			...request('b', 'next-request-secret'),
			prompt: 'After failed credential request',
		});
		expect((await waitForMessage('b', result.assistantMessageId))?.status).toBe(
			'complete',
		);
		const matched = requests.filter((entry) =>
			entry.body.includes('After failed credential request'),
		);
		expect(matched.length).toBeGreaterThan(0);
		expect(
			matched.every(
				(entry) => entry.authorization === 'Bearer next-request-secret',
			),
		).toBe(true);
	});

	test('a queued job retains its own credentials even under a different active request, then clears the scope', async () => {
		const seen: Array<string | undefined> = [];
		const idle: Array<string | undefined> = [];
		const loop = runner.createSessionLoop({
			execute: async () => {
				await Promise.resolve();
				seen.push(credentials.getRequestApiKey('openai'));
			},
			onFailure: async () => {},
			onIdle: async () => {
				idle.push(credentials.getRequestApiKey('openai'));
			},
		});
		const opts = {
			sessionId: 'scoped-queue',
			assistantMessageId: 'first',
			projectRoot: root,
			agent: 'build',
			provider: 'openai' as const,
			model: 'gpt-4o-mini',
		};
		credentials.withRequestCredentials(
			{ openai: { apiKey: 'queued-secret' } },
			() => queue.enqueueAssistantRun(opts, async () => {}),
		);
		queue.enqueueAssistantRun(
			{ ...opts, assistantMessageId: 'no-credentials' },
			async () => {},
		);
		await credentials.withRequestCredentials(
			{ openai: { apiKey: 'other-request' } },
			() => loop(opts.sessionId, root),
		);
		expect(seen).toEqual(['queued-secret', undefined]);
		expect(idle).toEqual([undefined]);
		expect(credentials.getRequestApiKey('openai')).toBeUndefined();
	});
});

test('ambiguous legacy queue lookup fails closed without touching either project', () => {
	const opts = {
		sessionId: 'same-id',
		assistantMessageId: 'one',
		projectRoot: join(root, 'a'),
		agent: 'build',
		provider: 'openai' as const,
		model: 'gpt-4o-mini',
	};
	queue.enqueueAssistantRun(opts, async () => {});
	queue.enqueueAssistantRun(
		{ ...opts, assistantMessageId: 'two', projectRoot: join(root, 'b') },
		async () => {},
	);
	expect(() => queue.getQueueState('same-id')).toThrow(
		'Ambiguous session queue',
	);
	expect(() => queue.abortSession('same-id')).toThrow(
		'Ambiguous session queue',
	);
	expect(
		queue.getQueueState('same-id', join(root, 'a'))?.queuedMessages[0]
			.messageId,
	).toBe('one');
	expect(
		queue.getQueueState('same-id', join(root, 'b'))?.queuedMessages[0]
			.messageId,
	).toBe('two');
	for (const project of ['a', 'b']) {
		queue.dequeueJob('same-id', join(root, project));
		queue.cleanupSession('same-id', join(root, project));
	}
});

test('stored OpenRouter API keys reach inference without exporting them to env', async () => {
	const { setAuth } = await import('../packages/sdk/src/auth/src/index.ts');
	const { loadConfig } = await import('@ottocode/sdk');
	const { resolveModel } = await import(
		'../packages/server/src/runtime/provider/index.ts'
	);
	const envKey = process.env.OPENROUTER_API_KEY;
	await setAuth('openrouter', { type: 'api', key: 'stored-router-secret' });
	const model = await resolveModel(
		'openrouter',
		'openai/gpt-4o-mini',
		await loadConfig(join(root, 'a')),
	);
	const before = requests.length;
	await model.doGenerate({
		prompt: [
			{
				role: 'user',
				content: [{ type: 'text', text: 'Stored router credential' }],
			},
		],
	});
	expect(
		requests
			.slice(before)
			.some((entry) => entry.authorization === 'Bearer stored-router-secret'),
	).toBe(true);
	expect(process.env.OPENROUTER_API_KEY).toBe(envKey);
});

test('scoped OpenRouter keys use the ordinary wrapper baseURL and cache affinity', async () => {
	const { loadConfig } = await import('@ottocode/sdk');
	const { resolveModel } = await import(
		'../packages/server/src/runtime/provider/index.ts'
	);
	const cfg = await loadConfig(join(root, 'a'));
	cfg.providers.openrouter = {
		...cfg.providers.openrouter,
		baseURL: 'https://scoped-router.example/v1',
	};
	const before = requests.length;
	await credentials.withRequestCredentials(
		{ openrouter: { apiKey: 'scoped-router-secret' } },
		async () => {
			const model = await resolveModel(
				'openrouter',
				'openai/gpt-4o-mini',
				cfg,
				{ sessionId: 'scoped-router-affinity' },
			);
			await model.doGenerate({
				prompt: [
					{
						role: 'user',
						content: [{ type: 'text', text: 'Scoped router request' }],
					},
				],
			});
		},
	);
	const [sent] = requests.slice(before);
	expect(sent.url).toBe('https://scoped-router.example/v1/chat/completions');
	expect(sent.authorization).toBe('Bearer scoped-router-secret');
	expect(JSON.parse(sent.body).session_id).toBe('scoped-router-affinity');
	expect(JSON.parse(sent.body).prompt_cache_key).toBe('scoped-router-affinity');
});
