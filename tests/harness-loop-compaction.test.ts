import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDb } from '@ottocode/database';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import {
	installCompactCommandCheckpoint,
	createFinishHandler,
} from '../packages/server/src/runtime/stream/finish-handler.ts';
import { publishAssistantMessageError } from '../packages/server/src/runtime/errors/assistant-message-error.ts';
import { createAbortHandler } from '../packages/server/src/runtime/stream/abort-handler.ts';
import type { RunOpts } from '../packages/server/src/runtime/session/queue.ts';
import { subscribeScopedSessionEvents } from '../packages/server/src/events/bus.ts';

let projectRoot = '';
beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-harness-manual-'));
});
afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

async function fixture(text: string) {
	const db = await getDb(projectRoot);
	const sessionId = crypto.randomUUID();
	await db.insert(sessions).values({
		id: sessionId,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		projectPath: projectRoot,
		createdAt: Date.now(),
		contextSummary: 'previous checkpoint',
	});
	const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
	for (const [index, id] of ids.entries()) {
		await db.insert(messages).values({
			id,
			sessionId,
			role: index === 1 ? 'user' : 'assistant',
			status: index === 2 ? 'pending' : 'complete',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			createdAt: Date.now(),
		});
	}
	const opts: RunOpts = {
		sessionId,
		assistantMessageId: ids[2],
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		projectRoot,
		isCompactCommand: true,
		compactionThroughMessageId: ids[0],
	};
	await db.insert(messageParts).values({
		id: crypto.randomUUID(),
		messageId: opts.assistantMessageId,
		index: 0,
		type: 'text',
		content: JSON.stringify({ text }),
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		startedAt: Date.now(),
	});
	return { db, opts, evidenceId: ids[0], queuedId: ids[1] };
}

const summary =
	'A complete evidence summary with enough detail to preserve all the important work and pending actions.';

describe('manual compaction durability', () => {
	for (const [reason, text] of [
		['length', summary],
		['error', summary],
		['stop', ''],
		['stop', 'short'],
	]) {
		test(`rejects ${reason}/${text.length} chars without changing the checkpoint`, async () => {
			const { db, opts } = await fixture(text);
			await expect(
				installCompactCommandCheckpoint(opts, db, { finishReason: reason }),
			).rejects.toThrow();
			const [session] = await db
				.select()
				.from(sessions)
				.where(eq(sessions.id, opts.sessionId));
			expect(session.contextSummary).toBe('previous checkpoint');
			expect(session.compactionMessageId).toBeNull();
		});
	}

	test('installs the evidence cutoff separately from the summary despite an intervening queued user turn', async () => {
		const { db, opts, evidenceId, queuedId } = await fixture(summary);
		await installCompactCommandCheckpoint(opts, db, { finishReason: 'stop' });
		const [session] = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, opts.sessionId));
		expect(session.contextSummary).toBe(summary);
		expect(session.compactionMessageId).toBe(opts.assistantMessageId);
		expect(session.compactionThroughMessageId).toBe(evidenceId);
		expect(session.compactionThroughMessageId).not.toBe(queuedId);
	});

	test('legacy finish callback cannot emit success after a failed completion write', async () => {
		const { db, opts } = await fixture(summary);
		const events: string[] = [];
		const unsub = subscribeScopedSessionEvents(
			opts.sessionId,
			(event) => {
				events.push(event.type);
			},
			projectRoot,
		);
		try {
			await expect(
				createFinishHandler(
					{ ...opts, isCompactCommand: false },
					db,
					async () => {
						throw new Error('failed completion write');
					},
				)({ finishReason: 'stop' }),
			).rejects.toThrow('failed completion write');
		} finally {
			unsub();
		}
		expect(events).not.toContain('message.completed');
	});
});

describe('terminal persistence ownership', () => {
	test('concurrent errors allocate one distinct error index and only one terminal transition', async () => {
		const { db, opts } = await fixture(summary);
		const outcomes = await Promise.all(
			[1, 2].map(() =>
				publishAssistantMessageError({
					db,
					opts,
					error: { message: 'failed', type: 'test' },
				}),
			),
		);
		expect(outcomes.filter((result) => result.persisted)).toHaveLength(1);
		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, opts.assistantMessageId));
		expect(parts.map((part) => part.index).sort()).toEqual([0, 1]);
	});

	test('late preemption cannot overwrite an existing failure', async () => {
		const { db, opts } = await fixture(summary);
		await publishAssistantMessageError({
			db,
			opts,
			error: { message: 'original failure', type: 'test' },
		});
		const controller = new AbortController();
		controller.abort({ type: 'send-now-preempt', nextMessageId: 'next' });
		await createAbortHandler(
			{ ...opts, abortSignal: controller.signal },
			db,
			() => 0,
			{ nextIndex: () => 2 } as never,
		)({ steps: [] });
		const [message] = await db
			.select()
			.from(messages)
			.where(eq(messages.id, opts.assistantMessageId));
		expect(message.status).toBe('error');
		expect(message.error).toBe('original failure');
		expect(message.finishReason).toBe('error');
	});
});
