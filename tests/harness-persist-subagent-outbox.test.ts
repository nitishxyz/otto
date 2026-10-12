import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '@ottocode/database';
import { messages, sessions, subagents } from '@ottocode/database/schema';
import { bundledMigrations } from '../packages/database/src/runtime/migrations-bundled.ts';
import {
	acceptParentContinuation,
	subagentResultsTurnClaim,
} from '../packages/server/src/runtime/message/parent-continuation.ts';
import { acceptUserTurn } from '../packages/server/src/runtime/message/create.ts';

const FIRST_NEW_MIGRATION = '0014_dedupe_running_subagents.sql';

function applyMigrations(
	sqlite: Database,
	migrations: typeof bundledMigrations,
) {
	for (const migration of migrations) {
		sqlite.exec('BEGIN TRANSACTION');
		sqlite.exec(migration.content);
		sqlite.exec('COMMIT');
	}
}

function insertLegacySubagent(
	sqlite: Database,
	row: {
		id: string;
		child: string;
		status: string;
		reported: number;
		createdAt: number;
	},
) {
	sqlite
		.query(
			`INSERT INTO subagents (id, parent_session_id, child_session_id, agent, task, status, summary, reported, created_at, updated_at)
			 VALUES (?, 'parent', ?, 'build', 'task', ?, NULL, ?, ?, ?)`,
		)
		.run(
			row.id,
			row.child,
			row.status,
			row.reported,
			row.createdAt,
			row.createdAt,
		);
}

describe('subagent attempt/outbox migration', () => {
	test('cancels duplicate running records, backfills delivery state, enforces one running per child', () => {
		const sqlite = new Database(':memory:');
		const index = bundledMigrations.findIndex(
			(migration) => migration.name === FIRST_NEW_MIGRATION,
		);
		expect(index).toBeGreaterThan(0);
		applyMigrations(sqlite, bundledMigrations.slice(0, index));

		insertLegacySubagent(sqlite, {
			id: 'old-running',
			child: 'c1',
			status: 'running',
			reported: 0,
			createdAt: 1,
		});
		insertLegacySubagent(sqlite, {
			id: 'new-running',
			child: 'c1',
			status: 'running',
			reported: 0,
			createdAt: 2,
		});
		insertLegacySubagent(sqlite, {
			id: 'done-reported',
			child: 'c2',
			status: 'completed',
			reported: 1,
			createdAt: 1,
		});
		insertLegacySubagent(sqlite, {
			id: 'done-pending',
			child: 'c2',
			status: 'failed',
			reported: 0,
			createdAt: 2,
		});

		applyMigrations(sqlite, bundledMigrations.slice(index));

		const rows = sqlite
			.query(
				'SELECT id, status, reported, delivery_state, attempt_seq, attempt_id, delivery_key, finished_message_id, summary, updated_at FROM subagents ORDER BY id',
			)
			.all() as Array<{
			id: string;
			status: string;
			reported: number;
			delivery_state: string;
			attempt_seq: number;
			attempt_id: string | null;
			delivery_key: string | null;
			finished_message_id: string | null;
			summary: string | null;
			updated_at: number;
		}>;
		const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
		expect(byId['new-running']?.status).toBe('running');
		expect(byId['new-running']?.delivery_state).toBe('none');
		expect(byId['old-running']?.status).toBe('cancelled');
		expect(byId['old-running']?.reported).toBe(0);
		expect(byId['old-running']?.delivery_state).toBe('pending');
		expect(byId['old-running']?.summary).toContain('superseded');
		expect(byId['old-running']?.updated_at).toBe(2);
		expect(byId['done-reported']?.delivery_state).toBe('delivered');
		expect(byId['done-pending']?.delivery_state).toBe('pending');
		for (const row of rows) {
			expect(row.attempt_seq).toBe(0);
			expect(row.attempt_id).toBeNull();
			expect(row.delivery_key).toBeNull();
			expect(row.finished_message_id).toBeNull();
		}

		expect(() =>
			insertLegacySubagent(sqlite, {
				id: 'second-running',
				child: 'c1',
				status: 'running',
				reported: 0,
				createdAt: 3,
			}),
		).toThrow();
		expect(() =>
			insertLegacySubagent(sqlite, {
				id: 'another-terminal',
				child: 'c1',
				status: 'completed',
				reported: 0,
				createdAt: 3,
			}),
		).not.toThrow();
		expect(() =>
			insertLegacySubagent(sqlite, {
				id: 'other-child-running',
				child: 'c3',
				status: 'running',
				reported: 0,
				createdAt: 3,
			}),
		).not.toThrow();
		sqlite.close();
	});
});

describe('parent continuation claims', () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(join(tmpdir(), 'otto-harness-outbox-'));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	async function setup() {
		const db = await getDb(root);
		const parentSessionId = crypto.randomUUID();
		await db.insert(sessions).values({
			id: parentSessionId,
			agent: 'build',
			provider: 'openai',
			model: 'gpt',
			projectPath: root,
			createdAt: Date.now(),
		});
		const insertRecord = async (
			id: string,
			patch: Partial<typeof subagents.$inferInsert> = {},
		) =>
			db
				.insert(subagents)
				.values({
					id,
					parentSessionId,
					childSessionId: `child-${id}`,
					agent: 'build',
					task: 'task',
					status: 'completed',
					summary: 'done',
					attemptSeq: 1,
					deliveryState: 'pending',
					createdAt: 10,
					updatedAt: 10,
					...patch,
				})
				.returning()
				.get();
		return { db, parentSessionId, insertRecord };
	}

	test('persists the parent turn and claims results atomically', async () => {
		const { db, parentSessionId, insertRecord } = await setup();
		const a = await insertRecord('a');
		const b = await insertRecord('b', { status: 'failed' });

		const result = await acceptParentContinuation({
			db,
			parentSessionId,
			agent: 'build',
			provider: 'openai',
			model: 'gpt',
			content: 'results',
			deliveryKey: 'key-1',
			claims: [a, b],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.claimedIds).toEqual(['a', 'b']);

		const rows = await db
			.select()
			.from(subagents)
			.where(eq(subagents.parentSessionId, parentSessionId));
		for (const row of rows) {
			expect(row.deliveryState).toBe('delivered');
			expect(row.reported).toBe(true);
			expect(row.deliveryKey).toBe('key-1');
			expect(row.updatedAt).toBe(10);
		}
		const parentMessages = await db
			.select()
			.from(messages)
			.where(eq(messages.sessionId, parentSessionId));
		expect(parentMessages.map((m) => m.id).sort()).toEqual(
			[result.userMessageId, result.assistantMessageId].sort(),
		);
	});

	test('rolls back the whole turn when any claim is stale', async () => {
		const { db, parentSessionId, insertRecord } = await setup();
		const fresh = await insertRecord('fresh');
		const changed = await insertRecord('changed');
		await db
			.update(subagents)
			.set({ attemptSeq: 2 })
			.where(eq(subagents.id, changed.id));
		const running = await insertRecord('running', {
			status: 'running',
			deliveryState: 'none',
		});

		const result = await acceptParentContinuation({
			db,
			parentSessionId,
			agent: 'build',
			provider: 'openai',
			model: 'gpt',
			content: 'results',
			deliveryKey: 'key-2',
			claims: [fresh, changed, running],
		});
		expect(result).toEqual({
			ok: false,
			reason: 'stale',
			staleIds: ['changed', 'running'],
		});
		const freshRow = await db
			.select()
			.from(subagents)
			.where(eq(subagents.id, fresh.id))
			.get();
		expect(freshRow?.deliveryState).toBe('pending');
		expect(freshRow?.reported).toBe(false);
		const parentMessages = await db
			.select()
			.from(messages)
			.where(eq(messages.sessionId, parentSessionId));
		expect(parentMessages).toHaveLength(0);
	});

	test('a second delivery of the same results is rejected', async () => {
		const { db, parentSessionId, insertRecord } = await setup();
		const a = await insertRecord('a');
		const claim = subagentResultsTurnClaim({
			parentSessionId,
			deliveryKey: 'key-3',
			claims: [a],
		});
		const turn = {
			db,
			sessionId: parentSessionId,
			agent: 'build',
			provider: 'openai' as const,
			model: 'gpt',
			content: 'results',
			createdAt: Date.now(),
			claim,
		};
		await acceptUserTurn(turn);
		await expect(acceptUserTurn(turn)).rejects.toThrow(
			'Sub-agent results changed before delivery',
		);
		const parentMessages = await db
			.select()
			.from(messages)
			.where(eq(messages.sessionId, parentSessionId));
		expect(parentMessages).toHaveLength(2);
	});

	test('claims from another parent session are stale', async () => {
		const { db, parentSessionId, insertRecord } = await setup();
		const a = await insertRecord('a');
		const otherParent = crypto.randomUUID();
		await db.insert(sessions).values({
			id: otherParent,
			agent: 'build',
			provider: 'openai',
			model: 'gpt',
			projectPath: root,
			createdAt: Date.now(),
		});
		const result = await acceptParentContinuation({
			db,
			parentSessionId: otherParent,
			agent: 'build',
			provider: 'openai',
			model: 'gpt',
			content: 'results',
			deliveryKey: 'key-4',
			claims: [a],
		});
		expect(result).toEqual({ ok: false, reason: 'stale', staleIds: ['a'] });
		const row = await db
			.select()
			.from(subagents)
			.where(eq(subagents.id, a.id))
			.get();
		expect(row?.deliveryState).toBe('pending');
		const otherMessages = await db
			.select()
			.from(messages)
			.where(eq(messages.sessionId, otherParent));
		expect(otherMessages).toHaveLength(0);
		expect(parentSessionId).not.toBe(otherParent);
	});
});
