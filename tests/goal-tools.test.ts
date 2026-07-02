import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { goals, messages, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { loadConfig } from '@ottocode/sdk';
import {
	buildGoalListTool,
	buildGoalUpdateTool,
} from '../packages/server/src/tools/goals/index.ts';
import {
	buildGoalKickoffMessage,
	ensureLooperSessionForGoal,
	maybeWakeLooper,
} from '../packages/server/src/runtime/looper/service.ts';

let projectRoot = '';
const LOOPER_SESSION_ID = 'looper-session-1';

type ToolExecute = (input: Record<string, unknown>) => Promise<{
	ok: boolean;
	error?: string;
	changes?: string[];
	goal?: { id: string; title: string; status: string } | null;
	tasks: Array<{
		id: string;
		position: number;
		content: string;
		status: string;
		note?: string;
		sessionId?: string;
	}>;
}>;

function getExecute(item: { tool: unknown }): ToolExecute {
	return (item.tool as { execute: ToolExecute }).execute;
}

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-goal-tools-'));
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('single-writer goal tools', () => {
	test('goal_list returns null when no goal exists', async () => {
		const listTool = buildGoalListTool({
			projectRoot,
			looperSessionId: LOOPER_SESSION_ID,
		});
		const result = await getExecute(listTool)({});
		expect(result.ok).toBe(true);
		expect(result.goal).toBeNull();
		expect(result.tasks).toEqual([]);
	});

	test('goal_update requires createGoal when no goal exists', async () => {
		const updateTool = buildGoalUpdateTool({
			projectRoot,
			looperSessionId: LOOPER_SESSION_ID,
		});
		const result = await getExecute(updateTool)({ addTasks: ['orphan task'] });
		expect(result.ok).toBe(false);
		expect(result.error).toContain('createGoal');
	});

	test('createGoal binds goal to the looper session', async () => {
		const updateTool = buildGoalUpdateTool({
			projectRoot,
			looperSessionId: LOOPER_SESSION_ID,
		});
		const result = await getExecute(updateTool)({
			createGoal: { title: 'Test goal' },
			addTasks: ['task one', 'task two'],
		});
		expect(result.ok).toBe(true);
		expect(result.goal?.title).toBe('Test goal');
		expect(result.tasks).toHaveLength(2);
		expect(result.tasks[0].status).toBe('pending');

		const db = await getDb(projectRoot);
		const rows = await db
			.select()
			.from(goals)
			.where(eq(goals.looperSessionId, LOOPER_SESSION_ID));
		expect(rows).toHaveLength(1);
		expect(rows[0].projectPath).toBe(
			(await loadConfig(projectRoot)).projectRoot,
		);
	});

	test('updateTasks records worker sessionId and status transitions', async () => {
		const updateTool = buildGoalUpdateTool({
			projectRoot,
			looperSessionId: LOOPER_SESSION_ID,
		});
		const execute = getExecute(updateTool);
		const list = await execute({});
		const taskId = list.tasks[0].id;

		const dispatched = await execute({
			updateTasks: [
				{ id: taskId, status: 'in_progress', sessionId: 'worker-1' },
			],
		});
		expect(dispatched.ok).toBe(true);
		const task = dispatched.tasks.find((t) => t.id === taskId);
		expect(task?.status).toBe('in_progress');
		expect(task?.sessionId).toBe('worker-1');

		const completed = await execute({
			updateTasks: [{ id: taskId, status: 'completed', note: 'verified' }],
		});
		const done = completed.tasks.find((t) => t.id === taskId);
		expect(done?.status).toBe('completed');
		expect(done?.note).toBe('verified');
	});

	test('done_pending is not an accepted task status', async () => {
		const updateTool = buildGoalUpdateTool({
			projectRoot,
			looperSessionId: LOOPER_SESSION_ID,
		});
		const inputSchema = (
			updateTool.tool as unknown as {
				inputSchema: { safeParse: (v: unknown) => { success: boolean } };
			}
		).inputSchema;
		const parsed = inputSchema.safeParse({
			updateTasks: [{ id: 'x', status: 'done_pending' }],
		});
		expect(parsed.success).toBe(false);
		const valid = inputSchema.safeParse({
			updateTasks: [{ id: 'x', status: 'blocked' }],
		});
		expect(valid.success).toBe(true);
	});

	test('goal_update preserves older task history and ordering', async () => {
		const updateTool = buildGoalUpdateTool({
			projectRoot,
			looperSessionId: 'looper-preserve-history',
		});
		const execute = getExecute(updateTool);
		const created = await execute({
			createGoal: { title: 'Preserve history' },
			addTasks: ['old task', 'new task'],
		});
		const [oldTask, newTask] = created.tasks;

		await execute({
			updateTasks: [{ id: oldTask.id, status: 'completed' }],
		});

		const inputSchema = (
			updateTool.tool as unknown as {
				inputSchema: { safeParse: (v: unknown) => { success: boolean } };
			}
		).inputSchema;
		const reorderAttempt = inputSchema.safeParse({
			updateTasks: [{ id: newTask.id, position: 0 }],
		});
		expect(reorderAttempt.success).toBe(false);

		const updated = await execute({
			updateTasks: [{ id: newTask.id, status: 'in_progress', position: 0 }],
		});
		expect(updated.tasks.map((task) => task.id)).toEqual([
			oldTask.id,
			newTask.id,
		]);
		expect(updated.tasks.find((task) => task.id === oldTask.id)?.status).toBe(
			'completed',
		);
		expect(updated.tasks.find((task) => task.id === newTask.id)?.status).toBe(
			'in_progress',
		);
	});

	test('completeGoal closes the goal', async () => {
		const updateTool = buildGoalUpdateTool({
			projectRoot,
			looperSessionId: LOOPER_SESSION_ID,
		});
		const execute = getExecute(updateTool);
		const list = await execute({});
		const openIds = list.tasks
			.filter((t) => t.status !== 'completed')
			.map((t) => t.id);
		await execute({
			updateTasks: openIds.map((id) => ({ id, status: 'cancelled' })),
		});
		const result = await execute({ completeGoal: true });
		expect(result.ok).toBe(true);
		expect(result.changes).toContain('goal completed');

		const listTool = buildGoalListTool({
			projectRoot,
			looperSessionId: LOOPER_SESSION_ID,
		});
		const after = await getExecute(listTool)({});
		expect(after.goal).toBeNull();
	});
});

describe('per-goal looper session binding', () => {
	test('ensureLooperSessionForGoal returns the bound looper session', async () => {
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const now = Date.now();
		await db.insert(sessions).values({
			id: 'looper-bound-1',
			agent: 'looper',
			provider: 'anthropic',
			model: 'test',
			projectPath: cfg.projectRoot,
			createdAt: now,
			sessionType: 'looper',
		});
		await db.insert(goals).values({
			id: 'goal-bound-1',
			projectPath: cfg.projectRoot,
			looperSessionId: 'looper-bound-1',
			title: 'Bound goal',
			status: 'active',
			createdAt: now,
			updatedAt: now,
		});
		const goalRow = (
			await db.select().from(goals).where(eq(goals.id, 'goal-bound-1'))
		)[0];
		const session = await ensureLooperSessionForGoal(db, cfg, goalRow);
		expect(session?.id).toBe('looper-bound-1');
	});

	test('non-looper goal binding is ignored and rebound to a looper session', async () => {
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const now = Date.now();
		await db.insert(sessions).values({
			id: 'bad-main-bound-1',
			agent: 'build',
			provider: 'anthropic',
			model: 'test',
			projectPath: cfg.projectRoot,
			createdAt: now,
			sessionType: 'main',
		});
		await db.insert(goals).values({
			id: 'goal-bad-bound-1',
			projectPath: cfg.projectRoot,
			looperSessionId: 'bad-main-bound-1',
			title: 'Bad bound goal',
			status: 'active',
			createdAt: now,
			updatedAt: now,
		});
		const goalRow = (
			await db.select().from(goals).where(eq(goals.id, 'goal-bad-bound-1'))
		)[0];
		const session = await ensureLooperSessionForGoal(db, cfg, goalRow);
		expect(session?.id).not.toBe('bad-main-bound-1');
		expect(session?.sessionType).toBe('looper');

		const rebound = (
			await db.select().from(goals).where(eq(goals.id, 'goal-bad-bound-1'))
		)[0];
		expect(rebound.looperSessionId).toBe(session?.id);
	});

	test('legacy parent-child looper session is adopted and backfilled', async () => {
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const now = Date.now();
		await db.insert(sessions).values({
			id: 'legacy-main-1',
			agent: 'build',
			provider: 'anthropic',
			model: 'test',
			projectPath: cfg.projectRoot,
			createdAt: now,
			sessionType: 'main',
		});
		await db.insert(sessions).values({
			id: 'legacy-looper-1',
			agent: 'looper',
			provider: 'anthropic',
			model: 'test',
			projectPath: cfg.projectRoot,
			createdAt: now,
			parentSessionId: 'legacy-main-1',
			sessionType: 'looper',
		});
		await db.insert(goals).values({
			id: 'goal-legacy-1',
			projectPath: cfg.projectRoot,
			sessionId: 'legacy-main-1',
			title: 'Legacy goal',
			status: 'active',
			createdAt: now,
			updatedAt: now,
		});
		const goalRow = (
			await db.select().from(goals).where(eq(goals.id, 'goal-legacy-1'))
		)[0];
		const session = await ensureLooperSessionForGoal(db, cfg, goalRow);
		expect(session?.id).toBe('legacy-looper-1');

		const backfilled = (
			await db.select().from(goals).where(eq(goals.id, 'goal-legacy-1'))
		)[0];
		expect(backfilled.looperSessionId).toBe('legacy-looper-1');
	});
});

describe('looper wakeup routing', () => {
	test('errored normal sessions without an active goal do not create legacy looper wakeups', async () => {
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const now = Date.now();
		await db.insert(sessions).values({
			id: 'error-main-no-goal-1',
			agent: 'build',
			provider: 'anthropic',
			model: 'test',
			projectPath: cfg.projectRoot,
			createdAt: now,
			sessionType: 'main',
		});
		await db.insert(messages).values({
			id: 'error-main-no-goal-message-1',
			sessionId: 'error-main-no-goal-1',
			role: 'assistant',
			status: 'failed',
			agent: 'build',
			provider: 'anthropic',
			model: 'test',
			createdAt: now,
			finishReason: 'error',
		});

		const session = (
			await db
				.select()
				.from(sessions)
				.where(eq(sessions.id, 'error-main-no-goal-1'))
		)[0];
		await maybeWakeLooper({ db, cfg, session });

		const legacyLooperSessions = await db
			.select()
			.from(sessions)
			.where(eq(sessions.parentSessionId, 'error-main-no-goal-1'));
		expect(legacyLooperSessions).toEqual([]);
	});
});

describe('goal kickoff message', () => {
	test('includes tasks and orchestration instructions', () => {
		const now = Date.now();
		const goal = {
			id: 'g1',
			projectPath: '/p',
			sessionId: null,
			looperSessionId: 'o1',
			title: 'Ship feature',
			status: 'active',
			startedAt: null,
			createdAt: now,
			updatedAt: now,
		};
		const tasks = [
			{
				id: 't1',
				goalId: 'g1',
				sessionId: null,
				position: 0,
				content: 'do the thing',
				status: 'pending',
				note: null,
				createdAt: now,
				updatedAt: now,
			},
		];
		const message = buildGoalKickoffMessage(goal, tasks);
		expect(message.startsWith('<looper_kickoff goal-id="g1">')).toBe(true);
		expect(message).toContain('</looper_kickoff>');
		expect(message).toContain('<task id="t1" status="pending" position="0">');
		expect(message).toContain('<instructions>');
		expect(message).toContain('Ship feature');
		expect(message).toContain('do the thing');
		expect(message).toContain('goal_update');
		expect(message).toContain('delegate_task');
		expect(message).not.toContain('done_pending');
	});
});
