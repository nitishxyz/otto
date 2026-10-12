import { describe, expect, test } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { eq, sql } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subscribe } from '../packages/server/src/events/bus.ts';
import { installCompactionCheckpoint } from '../packages/server/src/runtime/message/compaction-checkpoint.ts';
import { buildCompactionContext } from '../packages/server/src/runtime/message/compaction-context.ts';
import { pruneSession } from '../packages/server/src/runtime/message/compaction-prune.ts';
import { acceptUserTurn } from '../packages/server/src/runtime/message/create.ts';
import { buildHistoryMessages } from '../packages/server/src/runtime/message/history-builder.ts';
import { validateSummary } from '../packages/server/src/runtime/message/summary-validation.ts';
import { createBranch } from '../packages/server/src/runtime/session/branch.ts';

type Db = Awaited<ReturnType<typeof getDb>>;

async function fixture() {
	const projectRoot = mkdtempSync(join(tmpdir(), 'otto-harness-persist-'));
	const db = await getDb(projectRoot);
	const sessionId = crypto.randomUUID();
	await db.insert(sessions).values({
		id: sessionId,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5.3-codex',
		projectPath: projectRoot,
		createdAt: Date.now(),
	});
	return { db, sessionId, projectRoot };
}

async function insertMessage(
	db: Db,
	sessionId: string,
	id: string,
	role: 'user' | 'assistant',
	parts: Array<{ type: string; content: unknown; toolName?: string }>,
	createdAt = 1_000,
) {
	await db.insert(messages).values({
		id,
		sessionId,
		role,
		status: 'complete',
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5.3-codex',
		createdAt,
	});
	for (const [index, part] of parts.entries()) {
		const content = part.content as { callId?: string };
		await db.insert(messageParts).values({
			id: `${id}-${index}`,
			messageId: id,
			index,
			type: part.type,
			content: JSON.stringify(part.content),
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5.3-codex',
			toolName: part.toolName,
			toolCallId: content.callId,
		});
	}
}

const text = (value: string) => ({ type: 'text', content: { text: value } });
const call = (name: string, callId: string, args: unknown) => ({
	type: 'tool_call',
	toolName: name,
	content: { name, callId, args },
});
const result = (
	name: string,
	callId: string,
	value: unknown,
	args?: unknown,
) => ({
	type: 'tool_result',
	toolName: name,
	content: { name, callId, result: value, args },
});

const SUMMARY = `# Session Checkpoint\n\n## Charter\n${'Keep going with the plan. '.repeat(4)}`;

describe('shared summary validator', () => {
	test('rejects truncated, failed, empty, and undersized summaries', () => {
		expect(validateSummary({ text: SUMMARY, finishReason: 'stop' })).toEqual({
			ok: true,
		});
		expect(validateSummary({ text: SUMMARY, finishReason: 'length' }).ok).toBe(
			false,
		);
		expect(validateSummary({ text: SUMMARY, finishReason: 'error' }).ok).toBe(
			false,
		);
		expect(validateSummary({ text: '   ', finishReason: 'stop' }).ok).toBe(
			false,
		);
		expect(
			validateSummary({ text: 'too short', finishReason: 'stop' }).ok,
		).toBe(false);
		expect(validateSummary({ text: 'short but allowed', minChars: 5 }).ok).toBe(
			true,
		);
	});
});

describe('checkpoint boundary', () => {
	test('a queued user message between the evidence cutoff and the summary survives', async () => {
		const { db, sessionId } = await fixture();
		await insertMessage(db, sessionId, 'old-user', 'user', [
			text('OLD REQUEST'),
		]);
		await insertMessage(db, sessionId, 'overflow', 'assistant', [
			text('OVERFLOWED TURN'),
		]);
		await insertMessage(db, sessionId, 'queued-user', 'user', [
			text('QUEUED FOLLOW-UP'),
		]);
		await insertMessage(db, sessionId, 'summary', 'assistant', [
			text('SUMMARY DISPLAY'),
		]);

		installCompactionCheckpoint({
			db,
			sessionId,
			summaryMessageId: 'summary',
			summarizedThroughMessageId: 'overflow',
			summary: SUMMARY,
		});

		const serialized = JSON.stringify(
			await buildHistoryMessages(db, sessionId),
		);
		expect(serialized).toContain('QUEUED FOLLOW-UP');
		expect(serialized).not.toContain('OLD REQUEST');
		expect(serialized).not.toContain('OVERFLOWED TURN');
		expect(serialized).not.toContain('SUMMARY DISPLAY');

		const context = await buildCompactionContext(db, sessionId, 4_000);
		expect(context).toContain('QUEUED FOLLOW-UP');
		expect(context).not.toContain('SUMMARY DISPLAY');
		expect(context).not.toContain('OVERFLOWED TURN');

		const row = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, sessionId))
			.limit(1);
		expect(row[0]?.compactionMessageId).toBe('summary');
		expect(row[0]?.compactionThroughMessageId).toBe('overflow');
	});

	test('orders same-millisecond messages by insertion sequence', async () => {
		const { db, sessionId } = await fixture();
		await insertMessage(db, sessionId, 'z-first', 'user', [text('FIRST')], 5);
		await insertMessage(db, sessionId, 'a-second', 'user', [text('SECOND')], 5);
		const serialized = JSON.stringify(
			await buildHistoryMessages(db, sessionId),
		);
		expect(serialized.indexOf('FIRST')).toBeLessThan(
			serialized.indexOf('SECOND'),
		);
	});

	test('installs the checkpoint and compacted parts atomically', async () => {
		const { db, sessionId } = await fixture();
		await insertMessage(db, sessionId, 'u', 'user', [text('hello')]);
		await insertMessage(db, sessionId, 'a', 'assistant', [
			call('shell', 'c1', { cmd: 'ls' }),
			result('shell', 'c1', 'output'),
		]);
		await db.run(
			sql.raw(
				`CREATE TEMP TRIGGER fail_checkpoint BEFORE UPDATE OF context_summary ON sessions BEGIN SELECT RAISE(ABORT, 'checkpoint write failed'); END`,
			),
		);
		try {
			expect(() =>
				installCompactionCheckpoint({
					db,
					sessionId,
					summaryMessageId: 'a',
					summary: SUMMARY,
					compactPartIds: ['a-0', 'a-1'],
				}),
			).toThrow('checkpoint write failed');
		} finally {
			await db.run(sql.raw('DROP TRIGGER fail_checkpoint'));
		}
		const parts = await db
			.select({ compactedAt: messageParts.compactedAt })
			.from(messageParts)
			.where(eq(messageParts.messageId, 'a'));
		expect(parts.every((part) => part.compactedAt === null)).toBe(true);
	});
});

describe('truthful pruning', () => {
	test('pruned results are shown as omitted, not as interrupted failures', async () => {
		const { db, sessionId } = await fixture();
		const big = 'x'.repeat(200_000);
		await insertMessage(db, sessionId, 'u1', 'user', [text('first')]);
		await insertMessage(db, sessionId, 'a1', 'assistant', [
			call('shell', 'old-call', { cmd: 'cat big' }),
			result('shell', 'old-call', big),
		]);
		await insertMessage(db, sessionId, 'u2', 'user', [text('second')]);
		await insertMessage(db, sessionId, 'u3', 'user', [text('third')]);

		const pruned = await pruneSession(db, sessionId);
		expect(pruned.pruned).toBe(1);

		const serialized = JSON.stringify(
			await buildHistoryMessages(db, sessionId),
		);
		expect(serialized).toContain('omitted by context compaction');
		expect(serialized).not.toContain('interrupted or failed');
		expect(serialized).not.toContain(big.slice(0, 1000));
	});
});

describe('history supersession', () => {
	test('applies supersession before model conversion, keyed by read range and maxLines', async () => {
		const { db, sessionId } = await fixture();
		const readResult = (content: string) => ({
			ok: true,
			path: 'src/a.ts',
			content,
		});
		await insertMessage(db, sessionId, 'u', 'user', [text('go')]);
		await insertMessage(db, sessionId, 'a', 'assistant', [
			call('glob', 'g1', { pattern: '**/*.ts' }),
			result('glob', 'g1', { files: ['OLD GLOB RESULT'] }),
			call('read', 'r1', { path: 'src/a.ts', maxLines: 10 }),
			result('read', 'r1', readResult('LIMITED READ')),
			call('read', 'r2', { path: 'src/a.ts' }),
			result('read', 'r2', readResult('FIRST FULL READ')),
			call('glob', 'g2', { pattern: '**/*.ts' }),
			result('glob', 'g2', { files: ['NEW GLOB RESULT'] }),
			call('read', 'r3', { path: 'src/a.ts' }),
			result('read', 'r3', readResult('SECOND FULL READ')),
		]);

		const serialized = JSON.stringify(
			await buildHistoryMessages(db, sessionId),
		);
		expect(serialized).not.toContain('OLD GLOB RESULT');
		expect(serialized).toContain('[previous glob] **/*.ts');
		expect(serialized).toContain('NEW GLOB RESULT');
		expect(serialized).not.toContain('FIRST FULL READ');
		expect(serialized).toContain('SECOND FULL READ');
		// Different maxLines is a different read identity.
		expect(serialized).toContain('LIMITED READ');
	});
});

describe('transactional turn acceptance', () => {
	test('a failed accept writes nothing and publishes nothing', async () => {
		const { db, sessionId } = await fixture();
		const events: string[] = [];
		const unsubscribe = subscribe(sessionId, (event) => {
			events.push(event.type);
		});
		await db.run(
			sql.raw(
				`CREATE TEMP TRIGGER fail_assistant BEFORE INSERT ON messages WHEN NEW.role = 'assistant' BEGIN SELECT RAISE(ABORT, 'assistant insert failed'); END`,
			),
		);
		try {
			await expect(
				acceptUserTurn({
					db,
					sessionId,
					agent: 'build',
					provider: 'openai',
					model: 'gpt-5.3-codex',
					content: 'hello',
					createdAt: Date.now(),
				}),
			).rejects.toThrow('assistant insert failed');
		} finally {
			await db.run(sql.raw('DROP TRIGGER fail_assistant'));
			unsubscribe();
		}
		const rows = await db
			.select()
			.from(messages)
			.where(eq(messages.sessionId, sessionId));
		expect(rows).toHaveLength(0);
		expect(events).not.toContain('message.created');
	});
});

describe('branching', () => {
	test('a branch after the boundary carries the remapped checkpoint', async () => {
		const { db, sessionId, projectRoot } = await fixture();
		await insertMessage(db, sessionId, 'u1', 'user', [text('OLD WORK')]);
		await insertMessage(db, sessionId, 'a1', 'assistant', [text('OLD REPLY')]);
		await insertMessage(db, sessionId, 'summary', 'assistant', [
			text('SUMMARY DISPLAY'),
		]);
		await insertMessage(db, sessionId, 'u2', 'user', [text('NEW WORK')]);
		installCompactionCheckpoint({
			db,
			sessionId,
			summaryMessageId: 'summary',
			summarizedThroughMessageId: 'a1',
			summary: SUMMARY,
		});

		const branch = await createBranch({
			db,
			parentSessionId: sessionId,
			fromMessageId: 'u2',
			projectPath: projectRoot,
		});
		expect(branch.session.contextSummary).toBe(SUMMARY.trim());
		expect(branch.session.compactionThroughMessageId).not.toBe('a1');
		expect(branch.session.compactionThroughMessageId).toBeTruthy();
		const serialized = JSON.stringify(
			await buildHistoryMessages(db, branch.session.id),
		);
		expect(serialized).toContain('NEW WORK');
		expect(serialized).not.toContain('OLD WORK');
		expect(serialized).not.toContain('SUMMARY DISPLAY');
	});

	test('a branch before the checkpoint keeps evidence without visibility flags', async () => {
		const { db, sessionId, projectRoot } = await fixture();
		await insertMessage(db, sessionId, 'u1', 'user', [text('OLD WORK')]);
		await insertMessage(db, sessionId, 'a1', 'assistant', [
			call('shell', 'c1', { cmd: 'ls' }),
			result('shell', 'c1', 'EVIDENCE OUTPUT'),
		]);
		await insertMessage(db, sessionId, 'a2', 'assistant', [text('LATER')]);
		installCompactionCheckpoint({
			db,
			sessionId,
			summaryMessageId: 'a2',
			summary: SUMMARY,
			compactPartIds: ['a1-0', 'a1-1'],
		});
		await db
			.update(sessions)
			.set({ inheritedContext: '# Session Handoff\nINHERITED' })
			.where(eq(sessions.id, sessionId));

		const branch = await createBranch({
			db,
			parentSessionId: sessionId,
			fromMessageId: 'a1',
			projectPath: projectRoot,
		});
		expect(branch.session.compactionMessageId).toBeNull();
		expect(branch.session.compactionThroughMessageId).toBeNull();
		expect(branch.session.contextSummary).toBe('# Session Handoff\nINHERITED');
		expect(branch.session.inheritedContext).toBe(
			'# Session Handoff\nINHERITED',
		);
		const serialized = JSON.stringify(
			await buildHistoryMessages(db, branch.session.id),
		);
		expect(serialized).toContain('OLD WORK');
		expect(serialized).toContain('EVIDENCE OUTPUT');
	});
});
