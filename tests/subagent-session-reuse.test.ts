import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { sessions, subagents } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { spawnSubagent } from '../packages/server/src/runtime/subagents/service.ts';

let projectRoot = '';
const PARENT_SESSION_ID = 'parent-1';
const CHILD_SESSION_ID = 'child-frontend-1';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-subagent-reuse-'));
	const db = await getDb(projectRoot);
	const cfg = await loadConfig(projectRoot);
	const now = Date.now();
	await db.insert(sessions).values([
		{
			id: PARENT_SESSION_ID,
			agent: 'otto',
			provider: 'anthropic',
			model: 'test',
			projectPath: cfg.projectRoot,
			createdAt: now,
			sessionType: 'otto',
		},
		{
			id: CHILD_SESSION_ID,
			agent: 'frontend',
			provider: 'anthropic',
			model: 'test',
			projectPath: cfg.projectRoot,
			createdAt: now,
			parentSessionId: PARENT_SESSION_ID,
			sessionType: 'subagent',
		},
		{
			id: 'unrelated-session',
			agent: 'frontend',
			provider: 'anthropic',
			model: 'test',
			projectPath: cfg.projectRoot,
			createdAt: now,
			sessionType: 'main',
		},
	]);
	await db.insert(subagents).values({
		id: 'subagent-prev',
		parentSessionId: PARENT_SESSION_ID,
		childSessionId: CHILD_SESSION_ID,
		agent: 'frontend',
		task: 'earlier frontend task',
		status: 'completed',
		summary: 'done',
		reported: true,
		createdAt: now,
		updatedAt: now,
	});
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('delegate_task session reuse validation', () => {
	test('rejects a reuse session that does not exist', async () => {
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const result = await spawnSubagent({
			db,
			cfg,
			parentSessionId: PARENT_SESSION_ID,
			parentAgent: 'otto',
			agent: 'frontend',
			task: 'follow-up task',
			reuseSessionId: 'missing-session',
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('not found');
	});

	test('rejects a reuse session not spawned from this parent', async () => {
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const result = await spawnSubagent({
			db,
			cfg,
			parentSessionId: PARENT_SESSION_ID,
			parentAgent: 'otto',
			agent: 'frontend',
			task: 'follow-up task',
			reuseSessionId: 'unrelated-session',
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('previously spawned from this session');
		}
	});

	test('rejects reuse across different agents', async () => {
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const result = await spawnSubagent({
			db,
			cfg,
			parentSessionId: PARENT_SESSION_ID,
			parentAgent: 'otto',
			agent: 'general',
			task: 'follow-up task',
			reuseSessionId: CHILD_SESSION_ID,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('only valid for the same agent');
		}
	});

	test('rejects reuse while a task is still running in the session', async () => {
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const now = Date.now();
		await db.insert(subagents).values({
			id: 'subagent-running',
			parentSessionId: PARENT_SESSION_ID,
			childSessionId: CHILD_SESSION_ID,
			agent: 'frontend',
			task: 'still running',
			status: 'running',
			summary: null,
			reported: false,
			createdAt: now,
			updatedAt: now,
		});
		const result = await spawnSubagent({
			db,
			cfg,
			parentSessionId: PARENT_SESSION_ID,
			parentAgent: 'otto',
			agent: 'frontend',
			task: 'follow-up task',
			reuseSessionId: CHILD_SESSION_ID,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('still running');
	});
});
