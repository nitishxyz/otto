import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import {
	messageParts,
	messages,
	sessions,
	subagents,
} from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { finalizeSubagentForChildSession } from '../packages/server/src/runtime/subagents/finalize.ts';
import { claimFinishedSubagentForReport } from '../packages/server/src/runtime/subagents/report.ts';

let projectRoot = '';
const now = Date.now();

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-subagent-followup-'));
	const db = await getDb(projectRoot);
	await db.insert(sessions).values({
		id: 'followup-child',
		agent: 'build',
		provider: 'test-provider',
		model: 'test-model',
		projectPath: projectRoot,
		createdAt: now,
		parentSessionId: 'followup-parent',
		sessionType: 'subagent',
	});
	await db.insert(subagents).values([
		{
			id: 'finalizing-subagent',
			parentSessionId: 'followup-parent',
			childSessionId: 'followup-child',
			agent: 'build',
			task: 'finish queued follow-up',
			status: 'running',
			summary: null,
			reported: true,
			createdAt: now,
			updatedAt: now,
		},
		{
			id: 'stale-report-subagent',
			parentSessionId: 'followup-parent',
			childSessionId: 'other-child',
			agent: 'build',
			task: 'avoid stale delivery',
			status: 'completed',
			summary: 'initial result',
			reported: false,
			createdAt: now,
			updatedAt: now,
		},
	]);
	await db.insert(messages).values({
		id: 'followup-assistant',
		sessionId: 'followup-child',
		role: 'assistant',
		status: 'complete',
		finishReason: 'stop',
		agent: 'build',
		provider: 'test-provider',
		model: 'test-model',
		createdAt: now + 1,
	});
	await db.insert(messageParts).values({
		id: 'followup-text',
		messageId: 'followup-assistant',
		index: 0,
		stepIndex: 0,
		type: 'text',
		content: JSON.stringify({ text: 'latest queued follow-up result' }),
		agent: 'build',
		provider: 'test-provider',
		model: 'test-model',
		startedAt: now + 1,
		completedAt: now + 2,
	});
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('subagent follow-up reporting', () => {
	test('makes a newly finalized follow-up reportable again', async () => {
		const db = await getDb(projectRoot);
		const result = await finalizeSubagentForChildSession(db, 'followup-child');

		expect(result).toMatchObject({
			status: 'completed',
			summary: 'latest queued follow-up result',
			reported: false,
		});
		const [record] = await db
			.select()
			.from(subagents)
			.where(eq(subagents.id, 'finalizing-subagent'));
		expect(record?.reported).toBe(false);
		expect(record?.updatedAt).toBeGreaterThan(now);
	});

	test('does not claim a stale result after a follow-up lifecycle change', async () => {
		const db = await getDb(projectRoot);
		const [stale] = await db
			.select()
			.from(subagents)
			.where(eq(subagents.id, 'stale-report-subagent'));
		expect(stale).toBeDefined();
		if (!stale) return;

		await db
			.update(subagents)
			.set({
				status: 'running',
				summary: null,
				updatedAt: now + 1,
			})
			.where(eq(subagents.id, stale.id));
		await db
			.update(subagents)
			.set({
				status: 'completed',
				summary: 'latest result',
				reported: false,
				updatedAt: now + 2,
			})
			.where(eq(subagents.id, stale.id));

		expect(claimFinishedSubagentForReport(db, stale)).toBe(false);
		const [current] = await db
			.select()
			.from(subagents)
			.where(eq(subagents.id, stale.id));
		expect(current?.reported).toBe(false);
		expect(current?.summary).toBe('latest result');
		expect(current && claimFinishedSubagentForReport(db, current)).toBe(true);
	});
});
