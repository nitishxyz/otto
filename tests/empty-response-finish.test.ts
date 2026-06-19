import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { createFinishHandler } from '../packages/server/src/runtime/stream/finish-handler.ts';
import type { FinishEvent } from '../packages/server/src/runtime/stream/types.ts';
import type { RunOpts } from '../packages/server/src/runtime/session/queue.ts';

let projectRoot = '';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-empty-response-'));
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

async function insertPendingAssistantRun(sessionId: string, messageId: string) {
	const db = await getDb(projectRoot);
	const now = Date.now();
	await db.insert(sessions).values({
		id: sessionId,
		agent: 'build',
		provider: 'huggingface',
		model: 'zai-org/GLM-5.2:together',
		projectPath: projectRoot,
		createdAt: now,
	});
	await db.insert(messages).values({
		id: messageId,
		sessionId,
		role: 'assistant',
		status: 'pending',
		agent: 'build',
		provider: 'huggingface',
		model: 'zai-org/GLM-5.2:together',
		createdAt: now,
	});
	return db;
}

describe('finish handler empty assistant response guard', () => {
	test('converts a successful finish with no assistant parts into an error part', async () => {
		const sessionId = 'empty-response-session';
		const messageId = 'empty-response-message';
		const db = await insertPendingAssistantRun(sessionId, messageId);
		const opts: RunOpts = {
			sessionId,
			assistantMessageId: messageId,
			agent: 'build',
			provider: 'huggingface',
			model: 'zai-org/GLM-5.2:together',
			projectRoot,
		};
		const completeAssistantMessage = async (
			fin: FinishEvent,
			_runOpts: RunOpts,
			_db: Awaited<ReturnType<typeof getDb>>,
		) => {
			await db
				.update(messages)
				.set({
					status: 'complete',
					completedAt: Date.now(),
					finishReason: fin.finishReason,
					rawFinishReason: fin.rawFinishReason,
				})
				.where(eq(messages.id, messageId));
		};

		const handler = createFinishHandler(opts, db, completeAssistantMessage);
		await handler({ finishReason: 'other' });

		const [message] = await db
			.select()
			.from(messages)
			.where(eq(messages.id, messageId))
			.limit(1);
		const [part] = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, messageId))
			.limit(1);
		const partContent = JSON.parse(part.content ?? '{}');

		expect(message.status).toBe('error');
		expect(message.errorType).toBe('empty_response');
		expect(message.finishReason).toBe('error');
		expect(part.type).toBe('error');
		expect(partContent.message).toBe(
			'Assistant response finished without returning any content.',
		);
		expect(partContent.type).toBe('empty_response');
		expect(partContent.details).toEqual({
			finishReason: 'other',
			provider: 'huggingface',
			model: 'zai-org/GLM-5.2:together',
		});
	});
});
