import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDb } from '@ottocode/database';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import {
	registerActiveShellProcess,
	listShellJobsForSession,
} from '../packages/server/src/runtime/tools/active-shells.ts';
import { withShellResultsPrepareStep } from '../packages/server/src/runtime/agent/runner/runner-shell-results.ts';
import { hasScopedRunningSubagentDescendant } from '../packages/server/src/runtime/agent/runner/runner-working.ts';
import { getOrCreateRunnerState } from '../packages/server/src/runtime/session/queue/state.ts';
import { abortSession } from '../packages/server/src/runtime/session/queue/abort.ts';
import {
	cleanupSession,
	setRunning,
} from '../packages/server/src/runtime/session/queue/lifecycle.ts';
import type { ToolAdapterContext } from '../packages/server/src/tools/adapter.ts';

let root = '';
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'otto-loop-project-scope-'));
});
afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

test('active shell result delivery reports only jobs in the current project', async () => {
	const a = join(root, 'a');
	const b = join(root, 'b');
	const db = await getDb(a);
	await db.insert(sessions).values({
		id: 'same-session',
		projectPath: a,
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		createdAt: Date.now(),
	});
	await db.insert(messages).values({
		id: 'parent-message',
		sessionId: 'same-session',
		role: 'assistant',
		status: 'pending',
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		createdAt: Date.now(),
	});
	const jobs = [a, b].map((projectRoot) => {
		const job = registerActiveShellProcess({
			projectRoot,
			sessionId: 'same-session',
			messageId: 'parent-message',
			command: 'echo done',
			cwd: projectRoot,
			abort: () => {},
			onDetach: () => {},
		});
		job.detach();
		job.complete({ status: 'completed', result: { ok: true }, exitCode: 0 });
		return job;
	});
	try {
		let index = 0;
		const ctx = {
			db,
			projectRoot: a,
			sessionId: 'same-session',
			messageId: 'parent-message',
			agent: 'build',
			provider: 'openai',
			model: 'gpt-5',
			nextIndex: () => index++,
		} as ToolAdapterContext;
		await withShellResultsPrepareStep(undefined, { db, ctx })({
			stepNumber: 1,
			steps: [],
			messages: [],
		});
		expect(listShellJobsForSession('same-session', a)[0].reported).toBe(true);
		expect(listShellJobsForSession('same-session', b)[0].reported).toBe(false);
		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, 'parent-message'));
		expect(parts).toHaveLength(2);
		expect(parts[0].content).toContain(jobs[0].jobId);
		expect(parts[0].content).not.toContain(jobs[1].jobId);
	} finally {
		for (const job of jobs) job.unregister();
	}
});

test('abort without a runner state preserves project scope for active shells', () => {
	const a = join(root, 'abort-a');
	const b = join(root, 'abort-b');
	const aborted: string[] = [];
	const jobs = [a, b].map((projectRoot) =>
		registerActiveShellProcess({
			projectRoot,
			sessionId: 'no-runner',
			messageId: 'same-message',
			command: 'sleep 10',
			cwd: projectRoot,
			abort: () => aborted.push(projectRoot),
			onDetach: () => {},
		}),
	);
	try {
		abortSession('no-runner', true, undefined, a);
		expect(aborted).toEqual([a]);
	} finally {
		for (const job of jobs) job.unregister();
	}
});

test('live descendant status uses scoped queue state for colliding child ids', async () => {
	const a = join(root, 'status-a');
	const b = join(root, 'status-b');
	const db = await getDb(a);
	await db.insert(sessions).values({
		id: 'same-child',
		projectPath: a,
		parentSessionId: 'parent',
		sessionType: 'subagent',
		agent: 'build',
		provider: 'openai',
		model: 'gpt-5',
		createdAt: Date.now(),
	});
	getOrCreateRunnerState('same-child', a);
	getOrCreateRunnerState('same-child', b);
	setRunning('same-child', true, b);
	try {
		expect(await hasScopedRunningSubagentDescendant(db, 'parent', a)).toBe(
			false,
		);
		setRunning('same-child', true, a);
		expect(await hasScopedRunningSubagentDescendant(db, 'parent', a)).toBe(
			true,
		);
	} finally {
		for (const projectRoot of [a, b]) {
			setRunning('same-child', false, projectRoot);
			cleanupSession('same-child', projectRoot);
		}
	}
});
