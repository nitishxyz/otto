import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messages, sessions, subagents } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abortSession } from '../packages/server/src/runtime/session/queue.ts';
import {
	messageSubagent,
	stopSubagent,
} from '../packages/server/src/runtime/subagents/service.ts';

let projectRoot = '';
const parentSessionId = 'parent-message-after-stop';
const childSessionId = 'child-message-after-stop';
const subagentId = 'subagent-message-after-stop';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-subagent-message-stop-'));
	const db = await getDb(projectRoot);
	const cfg = await loadConfig(projectRoot);
	const now = Date.now();
	await db.insert(sessions).values([
		{
			id: parentSessionId,
			agent: 'build',
			provider: cfg.defaults.provider,
			model: cfg.defaults.model,
			projectPath: cfg.projectRoot,
			createdAt: now,
			sessionType: 'main',
		},
		{
			id: childSessionId,
			agent: 'plan',
			provider: cfg.defaults.provider,
			model: cfg.defaults.model,
			projectPath: cfg.projectRoot,
			createdAt: now,
			parentSessionId,
			sessionType: 'subagent',
		},
	]);
	await db.insert(subagents).values({
		id: subagentId,
		parentSessionId,
		childSessionId,
		agent: 'plan',
		task: 'Original task',
		status: 'running',
		summary: null,
		reported: false,
		createdAt: now,
		updatedAt: now,
	});
});

afterAll(async () => {
	abortSession(childSessionId, true);
	await Bun.sleep(25);
	await rm(projectRoot, { recursive: true, force: true });
});

describe('subagent messages after parent stop', () => {
	test('resumes the existing child session with a follow-up message', async () => {
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const stopped = await stopSubagent({
			db,
			parentSessionId,
			subagentId,
		});
		expect(stopped.ok).toBe(true);

		const [cancelled] = await db
			.select({ status: subagents.status })
			.from(subagents)
			.where(eq(subagents.id, subagentId))
			.limit(1);
		expect(cancelled?.status).toBe('cancelled');

		const resumed = await messageSubagent({
			db,
			cfg,
			parentSessionId,
			subagentId,
			message: 'Resume with this follow-up.',
			delivery: 'queue',
		});
		expect(resumed).toMatchObject({
			ok: true,
			subagentId,
			childSessionId,
			delivery: 'queue',
		});
		if (!resumed.ok) throw new Error(resumed.error);

		const [assistantMessage] = await db
			.select({ id: messages.id, sessionId: messages.sessionId })
			.from(messages)
			.where(eq(messages.id, resumed.messageId))
			.limit(1);
		expect(assistantMessage).toEqual({
			id: resumed.messageId,
			sessionId: childSessionId,
		});
	});
});
