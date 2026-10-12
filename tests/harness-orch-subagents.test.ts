import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DB, getDb } from '@ottocode/database';
import {
	messageParts,
	messages,
	sessions,
	subagents,
} from '@ottocode/database/schema';
import { loadConfig, type OttoConfig } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import { finalizeSubagentForChildSession } from '../packages/server/src/runtime/subagents/finalize.ts';
import { messageSubagent } from '../packages/server/src/runtime/subagents/message.ts';
import { buildSubagentResultsPrompt } from '../packages/server/src/runtime/subagents/prompt.ts';
import {
	reportFinishedSubagents,
	subagentDeliveryKey,
} from '../packages/server/src/runtime/subagents/report.ts';
import { stopSubagent } from '../packages/server/src/runtime/subagents/stop.ts';
import {
	attemptOf,
	reserveSpawnAttempt,
	startSubagentAttempt,
	terminateSubagentAttempt,
	subagentAttemptTurnClaim,
} from '../packages/server/src/runtime/subagents/transitions.ts';
import { MAX_CONCURRENT_PER_PARENT } from '../packages/server/src/runtime/subagents/types.ts';
import { recoverInterruptedRuns } from '../packages/server/src/runtime/projects/recovery.ts';
import {
	acceptParentContinuation,
	claimSubagentResults,
	SubagentResultClaimConflictError,
} from '../packages/server/src/runtime/message/parent-continuation.ts';

let projectRoot = '';
let db: DB;
let cfg: OttoConfig;
let seq = 0;

function id(prefix: string): string {
	seq += 1;
	return `${prefix}-${seq}`;
}

/**
 * DB proxy whose message inserts fail (directly or inside a transaction),
 * simulating a dispatch that fails before the message is durable.
 */
function failingMessageDb<T extends object>(base: T): T {
	return new Proxy(base, {
		get(target, prop) {
			if (prop === 'insert') {
				return (table: unknown) => {
					if (table === messages) throw new Error('dispatch exploded');
					return (target as unknown as DB).insert(table as typeof messages);
				};
			}
			if (prop === 'transaction') {
				return (callback: (tx: object) => unknown, ...rest: unknown[]) =>
					(target as unknown as DB).transaction(
						(tx) => callback(failingMessageDb(tx)),
						...(rest as []),
					);
			}
			const value = Reflect.get(target, prop);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

async function insertSession(sessionId: string, parentSessionId?: string) {
	await db.insert(sessions).values({
		id: sessionId,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-4o-mini',
		projectPath: projectRoot,
		createdAt: Date.now(),
		...(parentSessionId
			? { parentSessionId, sessionType: 'subagent' as const }
			: {}),
	});
}

async function insertRecord(values: {
	parentSessionId: string;
	childSessionId: string;
	status: string;
	reported?: boolean;
	createdAt?: number;
	updatedAt?: number;
	summary?: string | null;
}) {
	const now = Date.now();
	const record = {
		id: id('sa'),
		agent: 'build',
		task: 'task',
		summary: values.summary ?? null,
		reported: values.reported ?? false,
		createdAt: values.createdAt ?? now,
		updatedAt: values.updatedAt ?? now,
		parentSessionId: values.parentSessionId,
		childSessionId: values.childSessionId,
		status: values.status,
		attemptSeq: 0,
		attemptId: null,
		deliveryState:
			values.status === 'running'
				? ('none' as const)
				: values.reported
					? ('delivered' as const)
					: ('pending' as const),
		deliveryKey: null,
		finishedMessageId: null,
	};
	await db.insert(subagents).values(record);
	return record;
}

async function readRecord(subagentId: string) {
	const [row] = await db
		.select()
		.from(subagents)
		.where(eq(subagents.id, subagentId));
	return row;
}

async function insertAssistant(
	sessionId: string,
	status: 'complete' | 'pending',
	text: string,
	createdAt = Date.now(),
) {
	const messageId = id('msg');
	await db.insert(messages).values({
		id: messageId,
		sessionId,
		role: 'assistant',
		status,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-4o-mini',
		createdAt,
		...(status === 'complete' ? { finishReason: 'stop' } : {}),
	});
	await db.insert(messageParts).values({
		id: id('part'),
		messageId,
		index: 0,
		stepIndex: 0,
		type: 'text',
		content: JSON.stringify({ text }),
		agent: 'build',
		provider: 'openai',
		model: 'gpt-4o-mini',
	});
	return messageId;
}

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-harness-orch-subagents-'));
	db = await getDb(projectRoot);
	cfg = await loadConfig(projectRoot);
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('subagent attempt transitions', () => {
	test('concurrent stop wins over a stale finalize', async () => {
		const parent = id('parent');
		const child = id('child');
		const record = await insertRecord({
			parentSessionId: parent,
			childSessionId: child,
			status: 'running',
		});
		const staleAttempt = attemptOf(record);

		const stopped = await stopSubagent({
			db,
			parentSessionId: parent,
			subagentId: record.id,
		});
		expect(stopped.ok).toBe(true);

		const finalized = terminateSubagentAttempt(db, staleAttempt, {
			status: 'completed',
			summary: 'late result',
			reported: false,
		});
		expect(finalized).toBeUndefined();
		const row = await readRecord(record.id);
		expect(row?.status).toBe('cancelled');
		expect(row?.summary).toBe('Stopped by the parent agent.');
	});

	test('stop loses cleanly after finalize already won', async () => {
		const parent = id('parent');
		const child = id('child');
		await insertSession(child, parent);
		const record = await insertRecord({
			parentSessionId: parent,
			childSessionId: child,
			status: 'running',
		});
		await insertAssistant(child, 'complete', 'done');
		const finalized = await finalizeSubagentForChildSession(db, child);
		expect(finalized?.status).toBe('completed');
		const stopped = await stopSubagent({
			db,
			parentSessionId: parent,
			subagentId: record.id,
		});
		expect(stopped.ok).toBe(false);
		expect((await readRecord(record.id))?.status).toBe('completed');
	});

	test('an old message completion cannot finalize a newly accepted follow-up', async () => {
		const parent = id('parent');
		const child = id('child');
		await insertSession(child, parent);
		const record = await insertRecord({
			parentSessionId: parent,
			childSessionId: child,
			status: 'running',
		});
		const oldMessage = await insertAssistant(child, 'complete', 'old');
		const followUp = startSubagentAttempt(db, {
			subagentId: record.id,
			parentSessionId: parent,
			allowedFrom: ['running'],
		});
		if (!followUp.ok) throw new Error(followUp.error);
		const newMessage = await insertAssistant(child, 'pending', '');
		db.transaction((tx) =>
			subagentAttemptTurnClaim(attemptOf(followUp.record))(tx, {
				userMessageId: '',
				assistantMessageId: newMessage,
			}),
		);
		expect(
			await finalizeSubagentForChildSession(db, child, {
				finishedMessageId: oldMessage,
			}),
		).toBeUndefined();
		expect((await readRecord(record.id))?.status).toBe('running');
	});

	test('a follow-up supersedes an in-flight finalize', async () => {
		const parent = id('parent');
		const child = id('child');
		const record = await insertRecord({
			parentSessionId: parent,
			childSessionId: child,
			status: 'running',
			updatedAt: Date.now() - 10,
		});
		const finalizeAttempt = attemptOf(record);
		const followUp = startSubagentAttempt(db, {
			subagentId: record.id,
			parentSessionId: parent,
			allowedFrom: ['running', 'completed', 'failed', 'cancelled'],
		});
		expect(followUp.ok).toBe(true);
		expect(
			terminateSubagentAttempt(db, finalizeAttempt, {
				status: 'completed',
				summary: 'old run result',
				reported: false,
			}),
		).toBeUndefined();
		expect((await readRecord(record.id))?.status).toBe('running');
	});

	test('finalize waits while the newest assistant message is pending', async () => {
		const parent = id('parent');
		const child = id('child');
		await insertSession(child, parent);
		const record = await insertRecord({
			parentSessionId: parent,
			childSessionId: child,
			status: 'running',
		});
		await insertAssistant(child, 'complete', 'first', Date.now() - 100);
		await insertAssistant(child, 'pending', '', Date.now());
		expect(await finalizeSubagentForChildSession(db, child)).toBeUndefined();
		expect((await readRecord(record.id))?.status).toBe('running');
	});

	test('older ids superseded in the same child session cannot be restarted', async () => {
		const parent = id('parent');
		const child = id('child');
		const older = await insertRecord({
			parentSessionId: parent,
			childSessionId: child,
			status: 'completed',
			createdAt: Date.now() - 1000,
		});
		const newer = await insertRecord({
			parentSessionId: parent,
			childSessionId: child,
			status: 'completed',
		});
		const result = startSubagentAttempt(db, {
			subagentId: older.id,
			parentSessionId: parent,
			allowedFrom: ['completed', 'failed', 'cancelled', 'running'],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain(newer.id);
		expect((await readRecord(older.id))?.status).toBe('completed');
	});

	test('capacity is reserved transactionally for spawn and restart', async () => {
		const parent = id('parent');
		const results = Array.from({ length: MAX_CONCURRENT_PER_PARENT + 3 }, () =>
			reserveSpawnAttempt(db, {
				id: id('spawn'),
				parentSessionId: parent,
				childSessionId: id('child'),
				agent: 'build',
				task: 'task',
			}),
		);
		expect(results.filter((result) => result.ok)).toHaveLength(
			MAX_CONCURRENT_PER_PARENT,
		);

		const failed = await insertRecord({
			parentSessionId: parent,
			childSessionId: id('child'),
			status: 'failed',
		});
		const retry = startSubagentAttempt(db, {
			subagentId: failed.id,
			parentSessionId: parent,
			allowedFrom: ['completed', 'failed'],
		});
		expect(retry.ok).toBe(false);
		if (!retry.ok) expect(retry.error).toContain('Too many running');
		expect((await readRecord(failed.id))?.status).toBe('failed');
	});

	test('one active attempt per child session', () => {
		const parent = id('parent');
		const child = id('child');
		const first = reserveSpawnAttempt(db, {
			id: id('spawn'),
			parentSessionId: parent,
			childSessionId: child,
			agent: 'build',
			task: 'a',
		});
		const second = reserveSpawnAttempt(db, {
			id: id('spawn'),
			parentSessionId: parent,
			childSessionId: child,
			agent: 'build',
			task: 'b',
		});
		expect(first.ok).toBe(true);
		expect(second.ok).toBe(false);
	});

	test('a failed follow-up dispatch restores the previous state', async () => {
		const parent = id('parent');
		const child = id('child');
		await insertSession(child, parent);
		const record = await insertRecord({
			parentSessionId: parent,
			childSessionId: child,
			status: 'completed',
			summary: 'earlier result',
			reported: true,
		});
		const result = await messageSubagent({
			db: failingMessageDb(db),
			cfg,
			parentSessionId: parent,
			subagentId: record.id,
			message: 'follow up',
		});
		expect(result.ok).toBe(false);
		const row = await readRecord(record.id);
		expect(row?.status).toBe('completed');
		expect(row?.summary).toBe('earlier result');
		expect(row?.reported).toBe(true);
	});
});

describe('subagent result outbox', () => {
	test('failed delivery leaves results pending instead of losing them', async () => {
		const parent = id('parent');
		await insertSession(parent);
		const record = await insertRecord({
			parentSessionId: parent,
			childSessionId: id('child'),
			status: 'completed',
			summary: 'result',
		});
		const delivered = await reportFinishedSubagents(
			failingMessageDb(db),
			cfg,
			parent,
		);
		expect(delivered).toBe(false);
		expect((await readRecord(record.id))?.reported).toBe(false);
	});

	test('transcript text alone does not acknowledge a pending delivery', async () => {
		const parent = id('parent');
		await insertSession(parent);
		const record = await insertRecord({
			parentSessionId: parent,
			childSessionId: id('child'),
			status: 'completed',
			summary: 'result',
		});
		const deliveryKey = subagentDeliveryKey([record]);
		const userMessageId = id('user');
		await db.insert(messages).values({
			id: userMessageId,
			sessionId: parent,
			role: 'user',
			status: 'complete',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-4o-mini',
			createdAt: Date.now(),
		});
		await db.insert(messageParts).values({
			id: id('part'),
			messageId: userMessageId,
			index: 0,
			type: 'text',
			content: JSON.stringify({
				text: buildSubagentResultsPrompt([record], { deliveryKey }),
				messageOrigin: 'agent-results',
			}),
			agent: 'build',
			provider: 'openai',
			model: 'gpt-4o-mini',
		});

		const delivered = await reportFinishedSubagents(
			failingMessageDb(db),
			cfg,
			parent,
		);
		expect(delivered).toBe(false);
		expect((await readRecord(record.id))?.reported).toBe(false);
	});

	test('active and idle claims share CAS and restart retries pending results', async () => {
		const parent = id('parent');
		await insertSession(parent);
		const record = await insertRecord({
			parentSessionId: parent,
			childSessionId: id('child'),
			status: 'completed',
			summary: 'result',
		});
		const args = {
			db,
			parentSessionId: parent,
			agent: 'build',
			provider: 'openai' as const,
			model: 'gpt-4o-mini',
			content: 'result',
			deliveryKey: subagentDeliveryKey([record]),
			claims: [record],
		};
		await expect(
			acceptParentContinuation({ ...args, db: failingMessageDb(db) }),
		).rejects.toThrow('dispatch exploded');
		expect((await readRecord(record.id))?.deliveryState).toBe('pending');
		recoverInterruptedRuns(db, Date.now() + 1);
		expect((await acceptParentContinuation(args)).ok).toBe(true);
		expect((await readRecord(record.id))?.deliveryState).toBe('delivered');
		expect(() =>
			db.transaction((tx) => claimSubagentResults(tx, args)),
		).toThrow(SubagentResultClaimConflictError);
		expect((await acceptParentContinuation(args)).ok).toBe(false);
	});

	test('an active claim rolls back when any rendered attempt is stale', async () => {
		const parent = id('parent');
		const first = await insertRecord({
			parentSessionId: parent,
			childSessionId: id('child'),
			status: 'completed',
		});
		const stale = await insertRecord({
			parentSessionId: parent,
			childSessionId: id('child'),
			status: 'completed',
		});
		startSubagentAttempt(db, {
			subagentId: stale.id,
			parentSessionId: parent,
			allowedFrom: ['completed'],
		});
		expect(() =>
			db.transaction((tx) =>
				claimSubagentResults(tx, {
					parentSessionId: parent,
					deliveryKey: 'active',
					claims: [first, stale],
				}),
			),
		).toThrow(SubagentResultClaimConflictError);
		expect((await readRecord(first.id))?.deliveryState).toBe('pending');
	});
});

describe('subagent compaction guidance', () => {
	test('flags compaction relative to the child model window', () => {
		const prompt = buildSubagentResultsPrompt([
			{
				id: 'small',
				agent: 'build',
				status: 'completed',
				task: 't',
				summary: 'ok',
				contextTokens: 100_000,
				contextWindowTokens: 128_000,
			},
			{
				id: 'large',
				agent: 'build',
				status: 'completed',
				task: 't',
				summary: 'ok',
				contextTokens: 340_000,
				contextWindowTokens: 1_000_000,
			},
		]);
		expect(prompt).toContain(
			'- small (build): 100k of 128k context tokens (over 60% of window',
		);
		expect(prompt).toContain('- large (build): 340k of 1000k context tokens\n');
	});
});

describe('interrupted run recovery', () => {
	test('only recovers attempts that started before the daemon', async () => {
		const parent = id('parent');
		const daemonStartedAt = Date.now();
		const resumed = await insertRecord({
			parentSessionId: parent,
			childSessionId: id('child'),
			status: 'running',
			createdAt: daemonStartedAt - 10_000,
			updatedAt: daemonStartedAt + 5,
		});
		const stale = await insertRecord({
			parentSessionId: parent,
			childSessionId: id('child'),
			status: 'running',
			reported: true,
			createdAt: daemonStartedAt - 10_000,
			updatedAt: daemonStartedAt - 5_000,
		});
		recoverInterruptedRuns(db, daemonStartedAt);
		expect((await readRecord(resumed.id))?.status).toBe('running');
		const recovered = await readRecord(stale.id);
		expect(recovered?.status).toBe('failed');
		expect(recovered?.reported).toBe(false);
	});
});
