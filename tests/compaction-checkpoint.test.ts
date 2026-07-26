import { describe, expect, test } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompactionContext } from '../packages/server/src/runtime/message/compaction-context.ts';
import { saveCompactionCheckpoint } from '../packages/server/src/runtime/message/compaction-checkpoint.ts';
import { buildHistoryMessages } from '../packages/server/src/runtime/message/history-builder.ts';

async function createSessionFixture() {
	const projectRoot = mkdtempSync(
		join(tmpdir(), 'otto-compaction-checkpoint-'),
	);
	const db = await getDb(projectRoot);
	const now = Date.now();
	const sessionId = crypto.randomUUID();

	await db.insert(sessions).values({
		id: sessionId,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5.3-codex',
		projectPath: projectRoot,
		createdAt: now,
		lastActiveAt: now,
		currentContextTokens: 120_000,
	});

	return { db, now, sessionId };
}

async function insertTextMessage(args: {
	db: Awaited<ReturnType<typeof getDb>>;
	sessionId: string;
	id: string;
	role: 'user' | 'assistant';
	text: string;
	createdAt: number;
}) {
	await args.db.insert(messages).values({
		id: args.id,
		sessionId: args.sessionId,
		role: args.role,
		status: 'complete',
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5.3-codex',
		createdAt: args.createdAt,
	});
	await args.db.insert(messageParts).values({
		id: `${args.id}-text`,
		messageId: args.id,
		index: 0,
		type: 'text',
		content: JSON.stringify({ text: args.text }),
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5.3-codex',
	});
}

describe('canonical compaction checkpoints', () => {
	test('replaces pre-checkpoint model history with the canonical summary', async () => {
		const { db, now, sessionId } = await createSessionFixture();
		await insertTextMessage({
			db,
			sessionId,
			id: 'old-user',
			role: 'user',
			text: 'OLD TRANSCRIPT THAT MUST NOT RETURN',
			createdAt: now,
		});
		await insertTextMessage({
			db,
			sessionId,
			id: 'checkpoint-message',
			role: 'assistant',
			text: '# Session Checkpoint\n\n## Charter\nKeep context tiny.',
			createdAt: now + 1,
		});
		await insertTextMessage({
			db,
			sessionId,
			id: 'tail-user',
			role: 'user',
			text: 'Continue with the history cutoff.',
			createdAt: now + 2,
		});

		await saveCompactionCheckpoint({
			db,
			sessionId,
			compactionMessageId: 'checkpoint-message',
			summary: '# Session Checkpoint\n\n## Charter\nKeep context tiny.',
		});

		const history = await buildHistoryMessages(db, sessionId);
		const serialized = JSON.stringify(history);
		expect(serialized).toContain('Continue with the history cutoff.');
		expect(serialized).not.toContain('OLD TRANSCRIPT THAT MUST NOT RETURN');
		expect(serialized).not.toContain('# Session Checkpoint');

		const session = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, sessionId))
			.limit(1);
		expect(session[0]?.compactionMessageId).toBe('checkpoint-message');
		expect(session[0]?.contextSummary).toContain('Keep context tiny.');
		expect(session[0]?.currentContextTokens).toBeNull();
	});

	test('merges the previous checkpoint with only the active tail', async () => {
		const { db, now, sessionId } = await createSessionFixture();
		await insertTextMessage({
			db,
			sessionId,
			id: 'old-user',
			role: 'user',
			text: 'OLD SECRET TRANSCRIPT',
			createdAt: now,
		});
		await insertTextMessage({
			db,
			sessionId,
			id: 'first-checkpoint',
			role: 'assistant',
			text: 'first displayed checkpoint',
			createdAt: now + 1,
		});
		await saveCompactionCheckpoint({
			db,
			sessionId,
			compactionMessageId: 'first-checkpoint',
			summary:
				'# Session Checkpoint\n\n## Charter\nPreserve the original product goal.\n\n## Next action\nEdit history-builder.ts.',
		});
		await insertTextMessage({
			db,
			sessionId,
			id: 'tail-user',
			role: 'user',
			text: 'Use an explicit checkpoint ID.',
			createdAt: now + 2,
		});
		await insertTextMessage({
			db,
			sessionId,
			id: 'tail-assistant',
			role: 'assistant',
			text: 'I am updating the schema now.',
			createdAt: now + 3,
		});

		const context = await buildCompactionContext(
			db,
			sessionId,
			4_000,
			'tail-assistant',
		);
		expect(context).toContain('PREVIOUS CHECKPOINT');
		expect(context).toContain('Preserve the original product goal.');
		expect(context).toContain('Use an explicit checkpoint ID.');
		expect(context).toContain('I am updating the schema now.');
		expect(context).not.toContain('OLD SECRET TRANSCRIPT');
	});

	test('a later checkpoint replaces the earlier checkpoint and tail', async () => {
		const { db, now, sessionId } = await createSessionFixture();
		await insertTextMessage({
			db,
			sessionId,
			id: 'first-checkpoint',
			role: 'assistant',
			text: 'FIRST CHECKPOINT DISPLAY',
			createdAt: now,
		});
		await insertTextMessage({
			db,
			sessionId,
			id: 'first-tail',
			role: 'user',
			text: 'FIRST TAIL',
			createdAt: now + 1,
		});
		await insertTextMessage({
			db,
			sessionId,
			id: 'second-checkpoint',
			role: 'assistant',
			text: 'SECOND CHECKPOINT DISPLAY',
			createdAt: now + 2,
		});
		await insertTextMessage({
			db,
			sessionId,
			id: 'second-tail',
			role: 'user',
			text: 'SECOND TAIL',
			createdAt: now + 3,
		});

		await saveCompactionCheckpoint({
			db,
			sessionId,
			compactionMessageId: 'first-checkpoint',
			summary: '# Session Checkpoint\n\nFirst canonical state.',
		});
		await saveCompactionCheckpoint({
			db,
			sessionId,
			compactionMessageId: 'second-checkpoint',
			summary: '# Session Checkpoint\n\nSecond canonical state.',
		});

		const history = await buildHistoryMessages(db, sessionId);
		const serialized = JSON.stringify(history);
		expect(serialized).toContain('SECOND TAIL');
		expect(serialized).not.toContain('FIRST TAIL');
		expect(serialized).not.toContain('FIRST CHECKPOINT DISPLAY');
		expect(serialized).not.toContain('SECOND CHECKPOINT DISPLAY');

		const session = await db
			.select({ contextSummary: sessions.contextSummary })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
			.limit(1);
		expect(session[0]?.contextSummary).toContain('Second canonical state.');
		expect(session[0]?.contextSummary).not.toContain('First canonical state.');
	});

	test('hard-bounds checkpoints while preserving charter and next action', async () => {
		const { db, sessionId } = await createSessionFixture();
		const summary = `# Session Checkpoint\n\n## Charter\nKEEP CHARTER\n${'x'.repeat(10_000)}\n## Next action\nKEEP NEXT ACTION`;

		await saveCompactionCheckpoint({
			db,
			sessionId,
			compactionMessageId: 'bounded-checkpoint',
			summary,
		});

		const session = await db
			.select({ contextSummary: sessions.contextSummary })
			.from(sessions)
			.where(eq(sessions.id, sessionId))
			.limit(1);
		const checkpoint = session[0]?.contextSummary ?? '';
		expect(checkpoint.length).toBe(6_000);
		expect(checkpoint).toContain('KEEP CHARTER');
		expect(checkpoint).toContain('KEEP NEXT ACTION');
		expect(checkpoint).toContain('middle truncated');
	});
});
