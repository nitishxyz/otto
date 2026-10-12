import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from 'bun:test';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunOpts } from '../packages/server/src/runtime/session/queue.ts';

if (process.env.OTTO_COMPACTION_DISPATCH_CHILD !== '1') {
	test('manual compaction dispatch regressions in an isolated runner', async () => {
		const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
			env: { ...process.env, OTTO_COMPACTION_DISPATCH_CHILD: '1' },
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
	}, 20_000);
} else {
	mock.module('../packages/server/src/runtime/provider/index.ts', () => ({
		resolveModel: async () => {
			throw new Error('Dispatch tests must not resolve a model');
		},
	}));
	mock.module('../packages/server/src/runtime/agent/runner.ts', () => ({
		runSessionLoop: async () => {
			throw new Error('Dispatch tests must not start a model run');
		},
	}));
	const { dispatchAssistantMessage } = await import(
		'../packages/server/src/runtime/message/service.ts'
	);
	const { prepareBuiltinCommand } = await import(
		'../packages/server/src/runtime/commands/builtins.ts'
	);
	const { buildHistoryMessages } = await import(
		'../packages/server/src/runtime/message/history-builder.ts'
	);
	const sessionOrder = await import(
		'../packages/server/src/runtime/message/session-order.ts'
	);
	const queue = await import('../packages/server/src/runtime/session/queue.ts');
	const { installCompactCommandCheckpoint } = await import(
		'../packages/server/src/runtime/stream/finish-handler.ts'
	);

	let projectRoot = '';
	beforeAll(async () => {
		projectRoot = await mkdtemp(join(tmpdir(), 'otto-compaction-dispatch-'));
	});
	afterEach(() => mock.restore());
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
		const [session] = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, sessionId));
		return { db, cfg, session, sessionId };
	}

	async function insertText(
		db: Awaited<ReturnType<typeof getDb>>,
		sessionId: string,
		role: 'user' | 'assistant',
		text: string,
		createdAt = Date.now(),
	) {
		const id = crypto.randomUUID();
		await db.insert(messages).values({
			id,
			sessionId,
			role,
			status: 'complete',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			createdAt,
		});
		await db.insert(messageParts).values({
			id: `${id}-text`,
			messageId: id,
			index: 0,
			type: 'text',
			content: JSON.stringify({ text }),
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
		});
		return id;
	}

	describe('external manual compaction snapshot dispatch', () => {
		test('carries the captured cutoff through dispatch and preserves turns queued before the summary', async () => {
			const { db, cfg, session, sessionId } = await fixture();
			await insertText(db, sessionId, 'assistant', 'OLD EVIDENCE');
			const boundaryId = await insertText(
				db,
				sessionId,
				'user',
				'LAST SNAPSHOT REQUEST',
			);
			let queuedId = '';
			const loadMessages = sessionOrder.loadSessionMessages;
			let snapshotCaptured = false;
			spyOn(sessionOrder, 'loadSessionMessages').mockImplementation(
				async (...args) => {
					const rows = await loadMessages(...args);
					if (!snapshotCaptured) {
						snapshotCaptured = true;
						// Arrives after boundary capture, before the context builder's query.
						queuedId = await insertText(
							db,
							sessionId,
							'user',
							'QUEUED REQUEST MUST SURVIVE',
						);
						await insertText(
							db,
							sessionId,
							'assistant',
							'QUEUED RESPONSE MUST SURVIVE',
						);
					}
					return rows;
				},
			);
			const enqueued: RunOpts[] = [];
			spyOn(queue, 'enqueueAssistantRun').mockImplementation((opts) => {
				enqueued.push(opts);
			});

			const result = await dispatchAssistantMessage({
				cfg,
				db,
				session,
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5',
				content: '/compact',
			});
			expect(enqueued).toHaveLength(1);
			const opts = enqueued[0];
			expect(opts.assistantMessageId).toBe(result.assistantMessageId);
			expect(opts.isCompactCommand).toBe(true);
			expect(opts.omitHistory).toBe(true);
			expect(opts.compactionThroughMessageId).toBe(boundaryId);
			expect(opts.compactionContext).toContain('LAST SNAPSHOT REQUEST');
			expect(opts.compactionContext).not.toContain('QUEUED');

			const summary =
				'The prior evidence and last snapshot request are summarized, with pending actions preserved for the next turn.';
			await db.insert(messageParts).values({
				id: crypto.randomUUID(),
				messageId: opts.assistantMessageId,
				index: 0,
				type: 'text',
				content: JSON.stringify({ text: summary }),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5',
			});
			await installCompactCommandCheckpoint(opts, db, { finishReason: 'stop' });
			const [checkpoint] = await db
				.select()
				.from(sessions)
				.where(eq(sessions.id, sessionId));
			expect(checkpoint.compactionThroughMessageId).toBe(boundaryId);
			expect(checkpoint.compactionMessageId).toBe(opts.assistantMessageId);
			expect(checkpoint.contextSummary).toBe(summary);
			const history = JSON.stringify(await buildHistoryMessages(db, sessionId));
			expect(history).toContain('QUEUED REQUEST MUST SURVIVE');
			expect(history).toContain('QUEUED RESPONSE MUST SURVIVE');
			expect(history).not.toContain('LAST SNAPSHOT REQUEST');
			const [queuedPart] = await db
				.select()
				.from(messageParts)
				.where(eq(messageParts.messageId, queuedId));
			expect(queuedPart.compactedAt).toBeNull();
		});

		test('captures canonical sequence order rather than the newest timestamp', async () => {
			const { db, cfg, sessionId } = await fixture();
			await insertText(
				db,
				sessionId,
				'assistant',
				'FIRST',
				Date.now() + 10_000,
			);
			const boundaryId = await insertText(
				db,
				sessionId,
				'user',
				'SECOND',
				Date.now() - 10_000,
			);
			const command = await prepareBuiltinCommand({
				cfg,
				db,
				sessionId,
				provider: 'openai',
				model: 'gpt-5',
				content: '/compact',
			});
			expect(command?.compactionThroughMessageId).toBe(boundaryId);
			expect(command?.compactionContext).toContain('SECOND');
		});

		test('rejects empty history before accepting or enqueueing a compact turn', async () => {
			const { db, cfg, session, sessionId } = await fixture();
			const enqueue = spyOn(queue, 'enqueueAssistantRun').mockImplementation(
				() => {},
			);
			await expect(
				dispatchAssistantMessage({
					cfg,
					db,
					session,
					agent: 'build',
					provider: 'openai',
					model: 'gpt-5',
					content: '/compact',
				}),
			).rejects.toThrow('Cannot compact an empty conversation');
			expect(enqueue).not.toHaveBeenCalled();
			expect(
				await sessionOrder.loadSessionMessages(db, sessionId),
			).toHaveLength(0);
		});
	});
}
