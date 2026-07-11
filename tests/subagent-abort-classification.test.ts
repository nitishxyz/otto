import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { createAbortHandler } from '../packages/server/src/runtime/stream/abort-handler.ts';
import type { RunOpts } from '../packages/server/src/runtime/session/queue.ts';

let projectRoot = '';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-subagent-abort-'));
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

async function insertRun(sessionId: string, messageId: string) {
	const db = await getDb(projectRoot);
	const now = Date.now();
	await db.insert(sessions).values({
		id: sessionId,
		agent: 'frontend',
		provider: 'anthropic',
		model: 'test',
		projectPath: projectRoot,
		createdAt: now,
		sessionType: 'subagent',
	});
	await db.insert(messages).values({
		id: messageId,
		sessionId,
		role: 'assistant',
		status: 'pending',
		agent: 'frontend',
		provider: 'anthropic',
		model: 'test',
		createdAt: now,
	});
	return db;
}

async function runAbortHandler(args: {
	sessionId: string;
	messageId: string;
	reason?: unknown;
}) {
	const db = await insertRun(args.sessionId, args.messageId);
	const controller = new AbortController();
	controller.abort(args.reason);
	const opts: RunOpts = {
		sessionId: args.sessionId,
		assistantMessageId: args.messageId,
		agent: 'frontend',
		provider: 'anthropic',
		model: 'test',
		projectRoot,
		abortSignal: controller.signal,
	};
	const handler = createAbortHandler(opts, db, () => 0, {
		nextIndex: async () => 0,
	} as never);
	await handler({ steps: [] });

	const [message] = await db
		.select()
		.from(messages)
		.where(eq(messages.id, args.messageId))
		.limit(1);
	const [part] = await db
		.select()
		.from(messageParts)
		.where(eq(messageParts.messageId, args.messageId))
		.limit(1);
	return { message, partContent: JSON.parse(part.content ?? '{}') };
}

describe('subagent abort classification', () => {
	test('persists parent-cascade aborts as non-user cancellations', async () => {
		const { message, partContent } = await runAbortHandler({
			sessionId: 'parent-cascade-session',
			messageId: 'parent-cascade-message',
			reason: { type: 'parent-session-aborted' },
		});

		expect(message.error).toBe(
			'Cancelled because the parent session was aborted',
		);
		expect(message.errorType).toBe('cancelled');
		expect(message.finishReason).toBe('cancelled');
		expect(message.isAborted).toBe(false);
		expect(partContent.isAborted).toBe(false);
		expect(partContent.message).toBe(
			'Cancelled because the parent session was aborted',
		);
	});

	test('persists parent-requested sub-agent stops as cancellations', async () => {
		const { message, partContent } = await runAbortHandler({
			sessionId: 'parent-stop-session',
			messageId: 'parent-stop-message',
			reason: { type: 'subagent-stopped-by-parent' },
		});

		expect(message.error).toBe('Stopped by the parent agent');
		expect(message.errorType).toBe('cancelled');
		expect(message.finishReason).toBe('cancelled');
		expect(message.isAborted).toBe(false);
		expect(partContent.isAborted).toBe(false);
		expect(partContent.message).toBe('Stopped by the parent agent');
	});

	test('keeps unreasoned aborts classified as user aborts', async () => {
		const { message, partContent } = await runAbortHandler({
			sessionId: 'user-abort-session',
			messageId: 'user-abort-message',
		});

		expect(message.error).toBe('Generation stopped by user');
		expect(message.errorType).toBe('abort');
		expect(message.finishReason).toBe('abort');
		expect(message.isAborted).toBe(true);
		expect(partContent.isAborted).toBe(true);
	});
});
