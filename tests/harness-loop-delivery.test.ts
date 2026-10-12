import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import {
	messageParts,
	messages,
	sessions,
	subagents,
} from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { withSubagentResultsPrepareStep } from '../packages/server/src/runtime/agent/runner/runner-subagent-results.ts';
import { claimSubagentResults } from '../packages/server/src/runtime/message/parent-continuation.ts';
import type { ToolAdapterContext } from '../packages/server/src/tools/adapter.ts';

let root = '';
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'otto-active-delivery-'));
});
afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

async function fixture() {
	const db = await getDb(root);
	const parent = crypto.randomUUID();
	const child = crypto.randomUUID();
	const messageId = crypto.randomUUID();
	const id = crypto.randomUUID();
	const now = Date.now();
	for (const sessionId of [parent, child])
		await db.insert(sessions).values({
			id: sessionId,
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			projectPath: root,
			createdAt: now,
		});
	await db.insert(messages).values({
		id: messageId,
		sessionId: parent,
		role: 'assistant',
		status: 'pending',
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		createdAt: now,
	});
	await db.insert(subagents).values({
		id,
		parentSessionId: parent,
		childSessionId: child,
		agent: 'build',
		task: 'Verify implementation',
		status: 'completed',
		summary: 'Verified implementation.',
		attemptId: crypto.randomUUID(),
		attemptSeq: 3,
		deliveryState: 'pending',
		createdAt: now,
		updatedAt: now,
	});
	let index = 0;
	const ctx = {
		db,
		projectRoot: root,
		sessionId: parent,
		messageId,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		nextIndex: () => index++,
	} as ToolAdapterContext;
	return { db, ctx, id, parent, messageId, now };
}

test('active-step delivery atomically persists a pair and claims the versioned outbox once', async () => {
	const f = await fixture();
	await withSubagentResultsPrepareStep(
		undefined,
		f,
	)({ stepNumber: 1, steps: [], messages: [] });
	const [record] = await f.db
		.select()
		.from(subagents)
		.where(eq(subagents.id, f.id));
	const parts = await f.db
		.select()
		.from(messageParts)
		.where(eq(messageParts.messageId, f.messageId));
	expect(record.deliveryState).toBe('delivered');
	expect(record.reported).toBe(true);
	expect(record.updatedAt).toBe(f.now);
	expect(record.attemptSeq).toBe(3);
	expect(parts).toHaveLength(2);
	expect(record.deliveryKey).toBe(parts[0].toolCallId);
	await withSubagentResultsPrepareStep(
		undefined,
		f,
	)({ stepNumber: 2, steps: [], messages: [] });
	expect(
		await f.db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, f.messageId)),
	).toHaveLength(2);
});

test('idle delivery claim prevents active-step duplicate delivery', async () => {
	const f = await fixture();
	const [record] = await f.db
		.select()
		.from(subagents)
		.where(eq(subagents.id, f.id));
	f.db.transaction((tx) =>
		claimSubagentResults(tx, {
			parentSessionId: f.parent,
			deliveryKey: 'idle-delivery',
			claims: [record],
		}),
	);
	await withSubagentResultsPrepareStep(
		undefined,
		f,
	)({ stepNumber: 1, steps: [], messages: [] });
	expect(
		await f.db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, f.messageId)),
	).toHaveLength(0);
});

test('pair persistence failure leaves the result pending and unreported', async () => {
	const f = await fixture();
	const ctx = { ...f.ctx, nextIndex: () => 0 };
	await withSubagentResultsPrepareStep(undefined, { db: f.db, ctx })({
		stepNumber: 1,
		steps: [],
		messages: [],
	});
	const [record] = await f.db
		.select()
		.from(subagents)
		.where(eq(subagents.id, f.id));
	expect(record.deliveryState).toBe('pending');
	expect(record.reported).toBe(false);
	expect(record.deliveryKey).toBeNull();
	expect(
		await f.db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, f.messageId)),
	).toHaveLength(0);
});
