import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { stopSubagent } from '../packages/server/src/runtime/subagents/service.ts';

let projectRoot = '';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-subagent-stop-'));
	const db = await getDb(projectRoot);
	const now = Date.now();
	await db.insert(subagents).values({
		id: 'subagent-running',
		parentSessionId: 'parent-1',
		childSessionId: 'child-1',
		agent: 'plan',
		task: 'inspect the project',
		status: 'running',
		summary: null,
		reported: false,
		createdAt: now,
		updatedAt: now,
	});
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('stopSubagent', () => {
	test('rejects a sub-agent owned by another parent', async () => {
		const db = await getDb(projectRoot);
		const result = await stopSubagent({
			db,
			parentSessionId: 'parent-2',
			subagentId: 'subagent-running',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('No sub-agent');
	});

	test('marks a running sub-agent cancelled and reported', async () => {
		const db = await getDb(projectRoot);
		const result = await stopSubagent({
			db,
			parentSessionId: 'parent-1',
			subagentId: 'subagent-running',
		});

		expect(result).toMatchObject({
			ok: true,
			subagentId: 'subagent-running',
			childSessionId: 'child-1',
			agent: 'plan',
			wasRunning: false,
			clearedQueuedMessages: 0,
		});
		const [record] = await db
			.select()
			.from(subagents)
			.where(eq(subagents.id, 'subagent-running'))
			.limit(1);
		expect(record.status).toBe('cancelled');
		expect(record.summary).toBe('Stopped by the parent agent.');
		expect(record.reported).toBe(true);
	});

	test('rejects stopping an already terminal sub-agent', async () => {
		const db = await getDb(projectRoot);
		const result = await stopSubagent({
			db,
			parentSessionId: 'parent-1',
			subagentId: 'subagent-running',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('already cancelled');
	});
});
