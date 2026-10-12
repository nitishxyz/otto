import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import {
	messages,
	messageParts,
	sessions,
	subagents,
} from '@ottocode/database/schema';
import { eq, sql } from 'drizzle-orm';
import { scheduleContinuation } from '../packages/server/src/runtime/agent/turn/continuation.ts';
import type { ContinuationKind } from '../packages/server/src/runtime/agent/turn/types.ts';
import { finalizeSubagentForChildSession } from '../packages/server/src/runtime/subagents/finalize.ts';
import { withSubagentResultsPrepareStep } from '../packages/server/src/runtime/agent/runner/runner-subagent-results.ts';
import {
	cleanupSession,
	dequeueJob,
	type RunOpts,
} from '../packages/server/src/runtime/session/queue.ts';
import type { ToolAdapterContext } from '../packages/server/src/tools/adapter.ts';

let root = '';
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'otto-continuation-attempt-'));
});
afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});
async function fixture() {
	const db = await getDb(root);
	const parent = crypto.randomUUID();
	const child = crypto.randomUUID();
	const original = crypto.randomUUID();
	const parentMessage = crypto.randomUUID();
	const id = crypto.randomUUID();
	const now = Date.now();
	await db.insert(sessions).values([
		{
			id: parent,
			projectPath: root,
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			createdAt: now,
		},
		{
			id: child,
			projectPath: root,
			parentSessionId: parent,
			sessionType: 'subagent',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			createdAt: now,
		},
	]);
	await db.insert(messages).values([
		{
			id: original,
			sessionId: child,
			role: 'assistant',
			status: 'complete',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			createdAt: now,
		},
		{
			id: parentMessage,
			sessionId: parent,
			role: 'assistant',
			status: 'pending',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			createdAt: now,
		},
	]);
	await db.insert(subagents).values({
		id,
		parentSessionId: parent,
		childSessionId: child,
		agent: 'build',
		task: 'Complete delegated task',
		status: 'running',
		attemptId: original,
		attemptSeq: 4,
		deliveryState: 'none',
		createdAt: now,
		updatedAt: now,
	});
	const opts: RunOpts = {
		sessionId: child,
		assistantMessageId: original,
		projectRoot: root,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
	};
	return { db, parent, child, original, parentMessage, id, opts };
}

describe('continuations preserve the logical subagent attempt', () => {
	test('failed continuation insertion rolls back attempt rebinding', async () => {
		const f = await fixture();
		f.db.run(
			sql.raw(
				`CREATE TRIGGER reject_continuation BEFORE INSERT ON messages WHEN NEW.session_id = '${f.child}' BEGIN SELECT RAISE(ABORT, 'reject continuation'); END`,
			),
		);
		try {
			await expect(
				scheduleContinuation({
					db: f.db,
					opts: f.opts,
					kind: 'max-output',
					counters: { continuationCount: 1 },
					runSessionLoop: async () => {},
				}),
			).rejects.toThrow();
			const [record] = await f.db
				.select()
				.from(subagents)
				.where(eq(subagents.id, f.id));
			expect(record.attemptId).toBe(f.original);
			expect(record.attemptSeq).toBe(4);
			expect(
				await f.db
					.select()
					.from(messages)
					.where(eq(messages.sessionId, f.child)),
			).toHaveLength(1);
		} finally {
			f.db.run(sql`DROP TRIGGER reject_continuation`);
		}
	});
	for (const kind of [
		'max-output',
		'stream-idle-retry',
		'auto-compact',
		'context-overflow',
	] as ContinuationKind[]) {
		test(`${kind} rebinds the assistant identity and finalizes/delivers exactly once`, async () => {
			const f = await fixture();
			const continuation = await scheduleContinuation({
				db: f.db,
				opts: f.opts,
				kind,
				counters: { continuationCount: 1 },
				runSessionLoop: async () => {},
			});
			expect(continuation).not.toBeNull();
			const [rebound] = await f.db
				.select()
				.from(subagents)
				.where(eq(subagents.id, f.id));
			expect(rebound.attemptId).toBe(continuation);
			expect(rebound.attemptSeq).toBe(4);
			expect(
				await finalizeSubagentForChildSession(f.db, f.child, {
					finishedMessageId: f.original,
				}),
			).toBeUndefined();
			await f.db
				.update(messages)
				.set({ status: 'complete', finishReason: 'stop' })
				.where(eq(messages.id, continuation ?? ''));
			await f.db.insert(messageParts).values({
				id: crypto.randomUUID(),
				messageId: continuation ?? '',
				index: 0,
				type: 'text',
				content: JSON.stringify({
					text: 'Delegated work completed after continuation.',
				}),
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5',
			});
			const result = await finalizeSubagentForChildSession(f.db, f.child, {
				finishedMessageId: continuation ?? '',
			});
			expect(result?.status).toBe('completed');
			expect(result?.finishedMessageId).toBe(continuation);
			expect(result?.deliveryState).toBe('pending');
			let index = 0;
			const ctx = {
				db: f.db,
				projectRoot: root,
				sessionId: f.parent,
				messageId: f.parentMessage,
				agent: 'build',
				provider: 'openai',
				model: 'gpt-5',
				nextIndex: () => index++,
			} as ToolAdapterContext;
			await withSubagentResultsPrepareStep(undefined, { db: f.db, ctx })({
				stepNumber: 1,
				steps: [],
				messages: [],
			});
			const [delivered] = await f.db
				.select()
				.from(subagents)
				.where(eq(subagents.id, f.id));
			expect(delivered.deliveryState).toBe('delivered');
			expect(delivered.reported).toBe(true);
			expect(
				await finalizeSubagentForChildSession(f.db, f.child, {
					finishedMessageId: continuation ?? '',
				}),
			).toBeUndefined();
			dequeueJob(f.child, root);
			cleanupSession(f.child, root);
		});
	}
	for (const status of ['cancelled', 'running']) {
		test(`a ${status === 'running' ? 'superseding follow-up' : 'stop'} prevents stale scheduling`, async () => {
			const f = await fixture();
			const attemptId = status === 'running' ? 'new-followup' : f.original;
			await f.db
				.update(subagents)
				.set({ status, attemptId })
				.where(eq(subagents.id, f.id));
			expect(
				await scheduleContinuation({
					db: f.db,
					opts: f.opts,
					kind: 'max-output',
					counters: { continuationCount: 1 },
					runSessionLoop: async () => {},
				}),
			).toBeNull();
			const rows = await f.db
				.select()
				.from(messages)
				.where(eq(messages.sessionId, f.child));
			expect(rows).toHaveLength(1);
			const [record] = await f.db
				.select()
				.from(subagents)
				.where(eq(subagents.id, f.id));
			expect(record.attemptId).toBe(attemptId);
		});
	}
});
