import { describe, expect, test } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messages, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverContextOverflow } from '../packages/server/src/runtime/agent/runner/runner-context-overflow.ts';
import {
	cleanupSession,
	dequeueJob,
	getRunnerState,
} from '../packages/server/src/runtime/session/queue.ts';

describe('context overflow recovery', () => {
	test('compacts and queues exactly one continuation', async () => {
		const projectRoot = mkdtempSync(join(tmpdir(), 'otto-overflow-recovery-'));
		const db = await getDb(projectRoot);
		const sessionId = crypto.randomUUID();
		const assistantMessageId = crypto.randomUUID();
		const now = Date.now();

		await db.insert(sessions).values({
			id: sessionId,
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			projectPath: projectRoot,
			createdAt: now,
			lastActiveAt: now,
		});
		await db.insert(messages).values({
			id: assistantMessageId,
			sessionId,
			role: 'assistant',
			status: 'pending',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			createdAt: now,
		});

		let compactions = 0;
		const recover = () =>
			recoverContextOverflow({
				db,
				opts: {
					sessionId,
					assistantMessageId,
					agent: 'build',
					provider: 'openai',
					model: 'gpt-5.3-codex',
					projectRoot,
				},
				runSessionLoop: async () => {},
				runCompaction: async ({ throughMessageId }) => {
					compactions += 1;
					expect(throughMessageId).toBe(assistantMessageId);
					return { succeeded: true, compactMessageId: 'checkpoint' };
				},
			});

		expect(await recover()).toBe('retried');
		expect(await recover()).toBe('handled');
		expect(compactions).toBe(1);

		const original = await db
			.select({ status: messages.status })
			.from(messages)
			.where(eq(messages.id, assistantMessageId))
			.limit(1);
		expect(original[0]?.status).toBe('complete');

		const queue = getRunnerState(sessionId)?.queue ?? [];
		expect(queue).toHaveLength(1);
		expect(queue[0]?.assistantMessageId).not.toBe(assistantMessageId);
		expect(queue[0]?.compactionRetries).toBe(1);

		dequeueJob(sessionId);
		cleanupSession(sessionId);
	});
});
