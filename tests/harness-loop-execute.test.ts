import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, type DB } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { eq, sql } from 'drizzle-orm';
import { tool } from 'ai';
import { z } from 'zod';
import { adaptTools } from '../packages/server/src/tools/adapter.ts';
import { ToolResultDurabilityError } from '@ottocode/sdk/tools/error';
import { createTurnTerminal } from '../packages/server/src/runtime/agent/turn/terminal.ts';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { createSessionLoop } from '../packages/server/src/runtime/agent/runner.ts';
import { executeAssistantTurn } from '../packages/server/src/runtime/agent/turn/execute.ts';
import type { SetupResult } from '../packages/server/src/runtime/agent/runner/runner-setup.ts';
import { createToolRegistrationMap } from '../packages/server/src/runtime/agent/runner/runner-tool-registration.ts';
import {
	enqueueAssistantRun,
	cleanupSession,
	type RunOpts,
} from '../packages/server/src/runtime/session/queue.ts';
import {
	subscribeScopedSessionEvents,
	subscribeClientEvents,
} from '../packages/server/src/events/bus.ts';

let projectRoot = '';
beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-harness-execute-'));
});
afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

async function fixture() {
	const db = await getDb(projectRoot);
	const cfg = await loadConfig(projectRoot);
	const sessionId = crypto.randomUUID();
	await db.insert(sessions).values({
		id: sessionId,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		projectPath: projectRoot,
		createdAt: Date.now(),
	});
	async function job(): Promise<RunOpts> {
		const assistantMessageId = crypto.randomUUID();
		await db.insert(messages).values({
			id: assistantMessageId,
			sessionId,
			role: 'assistant',
			status: 'pending',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			createdAt: Date.now(),
		});
		return {
			sessionId,
			assistantMessageId,
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			projectRoot,
		};
	}
	return { db, cfg, job, sessionId };
}

function scriptedModel(chunks: LanguageModelV3StreamPart[]) {
	return new MockLanguageModelV3({
		doStream: async () => ({
			stream: simulateReadableStream({
				chunks,
				initialDelayInMs: null,
				chunkDelayInMs: null,
			}),
		}),
	});
}

const successfulChunks: LanguageModelV3StreamPart[] = [
	{ type: 'text-start', id: 'text' },
	{ type: 'text-delta', id: 'text', delta: 'Completed scripted turn.' },
	{ type: 'text-end', id: 'text' },
	{
		type: 'finish',
		finishReason: { unified: 'stop', raw: 'stop' },
		usage: {
			inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
			outputTokens: { total: 5, text: 5, reasoning: 0 },
		},
	},
];

function prepare(
	f: Awaited<ReturnType<typeof fixture>>,
	db: DB,
	model: MockLanguageModelV3,
) {
	return async (opts: RunOpts): Promise<SetupResult> => {
		let index = 0;
		return {
			cfg: {
				...f.cfg,
				defaults: { ...f.cfg.defaults, autoCompactThresholdTokens: undefined },
			},
			db,
			model,
			history: [
				{ role: 'assistant', content: 'Previous turn.' },
				{ role: 'user', content: 'Do the task.' },
			],
			system: 'Complete the task.',
			systemComponents: [],
			systemSegments: [],
			additionalSystemMessages: [],
			capabilities: { transport: 'default' },
			maxOutputTokens: undefined,
			effectiveMaxOutputTokens: undefined,
			toolset: {},
			toolRegistration: createToolRegistrationMap(),
			lazyToolsRecord: {},
			mcpToolsRecord: {},
			mcpToolBriefs: [],
			sharedCtx: {
				sessionId: opts.sessionId,
				messageId: opts.assistantMessageId,
				assistantPartId: crypto.randomUUID(),
				db,
				agent: opts.agent,
				provider: opts.provider,
				model: opts.model,
				projectRoot,
				nextIndex: () => index++,
			},
			firstToolTimer: { end: () => {} },
			firstToolSeen: () => false,
			providerOptions: {},
			isOpenAIOAuth: false,
			needsSpoof: false,
			timings: { totalMs: 0 },
		} as SetupResult;
	};
}

function failingContentDb(db: DB): DB {
	return new Proxy(db, {
		get(target, key) {
			if (key === 'update')
				return (table: unknown) => {
					const builder = target.update(table as typeof messageParts);
					if (table !== messageParts) return builder;
					return {
						set: (values: Record<string, unknown>) => {
							if ('content' in values)
								return {
									where: () => Promise.reject(new Error('disk write failed')),
								};
							return builder.set(values);
						},
					};
				};
			const value = Reflect.get(target, key);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

describe('scripted assistant loop', () => {
	test('successful mutation with failed SQLite result inserts fails the turn without another execution or model step', async () => {
		const f = await fixture();
		const opts = await f.job();
		const target = join(projectRoot, 'mutation-once.txt');
		let executions = 0;
		const model = scriptedModel([
			{
				type: 'tool-call',
				toolCallId: 'mutation-call',
				toolName: 'progress_update',
				input: '{}',
			},
			{
				type: 'finish',
				finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
				usage: {
					inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 5, text: 5, reasoning: 0 },
				},
			},
		]);
		const setup = await prepare(f, f.db, model)(opts);
		setup.toolset = adaptTools(
			[
				{
					name: 'progress_update',
					tool: tool({
						inputSchema: z.object({}),
						execute: async () => {
							executions++;
							await writeFile(target, 'mutation committed');
							return { ok: true };
						},
					}),
				},
			],
			setup.sharedCtx,
			'openai',
			'api',
		);
		f.db.run(
			sql`CREATE TRIGGER reject_tool_result BEFORE INSERT ON message_parts WHEN NEW.type = 'tool_result' BEGIN SELECT RAISE(ABORT, 'result insert failed'); END`,
		);
		const completed: unknown[] = [];
		const unsubscribe = subscribeScopedSessionEvents(
			f.sessionId,
			(event) => {
				if (event.type === 'message.completed') completed.push(event);
			},
			projectRoot,
		);
		try {
			await executeAssistantTurn(
				opts,
				async () => {},
				async () => setup,
			);
		} finally {
			unsubscribe();
			f.db.run(sql`DROP TRIGGER reject_tool_result`);
		}
		const [row] = await f.db
			.select()
			.from(messages)
			.where(eq(messages.id, opts.assistantMessageId));
		expect(row.status).toBe('error');
		expect(row.error).toContain('execution must not be repeated');
		expect(executions).toBe(1);
		expect(await readFile(target, 'utf8')).toBe('mutation committed');
		expect(model.doStreamCalls).toHaveLength(1);
		expect(completed).toHaveLength(0);
	});

	test('SDK cause wrappers preserve tool durability failure over idle-timeout retry hints', () => {
		const original = new ToolResultDurabilityError(
			'call',
			'write',
			{ status: 'success', result: { ok: true } },
			new Error('context_length_exceeded'),
		);
		const terminal = createTurnTerminal();
		terminal.recordFinish({ finishReason: 'stop' });
		terminal.recordError({
			error: new Error('SDK wrapper', { cause: original }),
		});
		expect(terminal.facts.persistenceError).toBe(original);
		expect(terminal.primaryError()).toBe(original);
	});
	test('drains a follow-up queued during the first streamed turn and reports the actual last assistant id', async () => {
		const f = await fixture();
		const first = await f.job();
		const followup = await f.job();
		const model = scriptedModel(successfulChunks);
		const executed: string[] = [];
		const idleIds: Array<string | undefined> = [];
		const loop = createSessionLoop({
			execute: async (opts, run) => {
				executed.push(opts.assistantMessageId);
				if (opts.assistantMessageId === first.assistantMessageId)
					await enqueueAssistantRun(followup, run);
				await executeAssistantTurn(opts, run, prepare(f, f.db, model));
			},
			onFailure: async (_opts, error) => {
				throw error;
			},
			onIdle: async (_session, _root, id) => {
				idleIds.push(id);
			},
		});
		enqueueAssistantRun(first, async () => {});
		await loop(f.sessionId, projectRoot);
		expect(executed).toEqual([
			first.assistantMessageId,
			followup.assistantMessageId,
		]);
		expect(idleIds).toEqual([followup.assistantMessageId]);
		const rows = await f.db
			.select()
			.from(messages)
			.where(eq(messages.sessionId, f.sessionId));
		expect(rows.every((row) => row.status === 'complete')).toBe(true);
		cleanupSession(f.sessionId, projectRoot);
	});

	test('a rejected writer barrier fails the turn without publishing completion or success', async () => {
		const f = await fixture();
		const opts = await f.job();
		const completed: unknown[] = [];
		const successes: unknown[] = [];
		const unsub = subscribeScopedSessionEvents(
			f.sessionId,
			(event) => {
				if (event.type === 'message.completed') completed.push(event);
			},
			projectRoot,
		);
		const unsubClient = subscribeClientEvents((event) => {
			if (
				event.type === 'notification' &&
				event.payload.level === 'success' &&
				event.payload.sessionId === f.sessionId
			)
				successes.push(event);
		});
		try {
			await executeAssistantTurn(
				opts,
				async () => {},
				prepare(f, failingContentDb(f.db), scriptedModel(successfulChunks)),
			);
		} finally {
			unsub();
			unsubClient();
		}
		const [row] = await f.db
			.select()
			.from(messages)
			.where(eq(messages.id, opts.assistantMessageId));
		expect(row.status).toBe('error');
		expect(completed).toHaveLength(0);
		expect(successes).toHaveLength(0);
		const parts = await f.db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, opts.assistantMessageId));
		expect(parts.filter((part) => part.type === 'error')).toHaveLength(1);
		expect(new Set(parts.map((part) => part.index)).size).toBe(parts.length);
	});

	test('a scripted error chunk is persisted as failure', async () => {
		const f = await fixture();
		const opts = await f.job();
		await executeAssistantTurn(
			opts,
			async () => {},
			prepare(
				f,
				f.db,
				scriptedModel([
					{ type: 'error', error: new Error('scripted stream failure') },
				]),
			),
		);
		const [row] = await f.db
			.select()
			.from(messages)
			.where(eq(messages.id, opts.assistantMessageId));
		expect(row.status).toBe('error');
		expect(row.error).toContain('scripted stream failure');
	});
});
