import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, type DB } from '@ottocode/database';
import { messages, sessions, subagents } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { recoverInterruptedRuns } from '../packages/server/src/runtime/projects/recovery.ts';

let projectRoot = '';
let db: DB;
let initialResult: ReturnType<typeof recoverInterruptedRuns>;
const daemonStartedAt = 10_000;

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-daemon-recovery-'));
	db = await getDb(projectRoot);
	await db
		.insert(sessions)
		.values([
			makeSession('old-main', 'main'),
			makeSession('old-child', 'subagent'),
			makeSession('current-main', 'main'),
		]);
	await db
		.insert(messages)
		.values([
			makeMessage('old-pending', 'old-main', 'pending', 1_000),
			makeMessage('old-complete', 'old-main', 'complete', 2_000),
			makeMessage(
				'current-pending',
				'current-main',
				'pending',
				daemonStartedAt,
			),
		]);
	await db.insert(subagents).values([
		{
			id: 'old-running-subagent',
			parentSessionId: 'old-main',
			childSessionId: 'old-child',
			agent: 'plan',
			task: 'Inspect the project',
			status: 'running',
			summary: null,
			reported: false,
			createdAt: 3_000,
			updatedAt: 3_000,
		},
		{
			id: 'current-running-subagent',
			parentSessionId: 'current-main',
			childSessionId: 'old-child',
			agent: 'plan',
			task: 'Inspect current work',
			status: 'running',
			summary: null,
			reported: false,
			createdAt: daemonStartedAt,
			updatedAt: daemonStartedAt,
		},
	]);
	initialResult = recoverInterruptedRuns(db, daemonStartedAt);
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('daemon run recovery', () => {
	test('fails persisted work left running by an earlier daemon', async () => {
		expect(initialResult).toEqual({ messages: 1, subagents: 1 });

		const [message] = await db
			.select()
			.from(messages)
			.where(eq(messages.id, 'old-pending'));
		expect(message).toMatchObject({
			status: 'error',
			errorType: 'daemon_interrupted',
			finishReason: 'error',
			isAborted: false,
		});
		expect(message.completedAt).toBeNumber();
		expect(message.error).toContain('daemon stopped');

		const [subagent] = await db
			.select()
			.from(subagents)
			.where(eq(subagents.id, 'old-running-subagent'));
		expect(subagent).toMatchObject({
			status: 'failed',
			reported: false,
		});
		expect(subagent.summary).toContain('daemon stopped');
	});

	test('does not alter terminal or current-daemon work', async () => {
		const rows = await db.select().from(messages);
		expect(rows.find((row) => row.id === 'old-complete')?.status).toBe(
			'complete',
		);
		expect(rows.find((row) => row.id === 'current-pending')?.status).toBe(
			'pending',
		);

		const [subagent] = await db
			.select()
			.from(subagents)
			.where(eq(subagents.id, 'current-running-subagent'));
		expect(subagent.status).toBe('running');
	});

	test('is idempotent', () => {
		expect(recoverInterruptedRuns(db, daemonStartedAt)).toEqual({
			messages: 0,
			subagents: 0,
		});
	});
});

function makeSession(id: string, sessionType: string) {
	return {
		id,
		title: id,
		agent: 'build',
		provider: 'test',
		model: 'test',
		projectPath: projectRoot,
		createdAt: 100,
		lastActiveAt: 100,
		sessionType,
	};
}

function makeMessage(
	id: string,
	sessionId: string,
	status: string,
	createdAt: number,
) {
	return {
		id,
		sessionId,
		role: 'assistant',
		status,
		agent: 'build',
		provider: 'test',
		model: 'test',
		createdAt,
		completedAt: status === 'complete' ? createdAt + 1 : null,
	};
}
