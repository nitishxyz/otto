import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { buildHistoryMessages } from '../packages/server/src/runtime/message/history-builder.ts';
import {
	cleanupSession,
	dequeueJob,
	enqueueAssistantRun,
	setRunning,
} from '../packages/server/src/runtime/session/queue.ts';
import {
	getRunningSessionTreeIds,
	hasRunningSubagentDescendant,
} from '../packages/server/src/runtime/session/working.ts';

let base = '';
let rootA = '';
let rootB = '';
const sessionId = crypto.randomUUID();
const parentId = crypto.randomUUID();

beforeAll(async () => {
	base = await mkdtemp(join(tmpdir(), 'otto-harness-scope-'));
	rootA = join(base, 'a');
	rootB = join(base, 'b');
});

afterAll(async () => {
	for (const root of [rootA, rootB]) {
		dequeueJob(sessionId, root);
		cleanupSession(sessionId, root);
	}
	await rm(base, { recursive: true, force: true });
});

async function seedProject(root: string, label: string) {
	const db = await getDb(root);
	await db.insert(sessions).values([
		{
			id: parentId,
			agent: 'build',
			provider: 'openai',
			model: 'gpt',
			projectPath: root,
			createdAt: 1,
		},
		{
			id: sessionId,
			agent: 'build',
			provider: 'openai',
			model: 'gpt',
			projectPath: root,
			sessionType: 'subagent',
			parentSessionId: parentId,
			createdAt: 1,
		},
	]);
	const row = (
		id: string,
		role: string,
		status: string,
		createdAt: number,
	) => ({
		id,
		sessionId,
		role,
		status,
		agent: 'build',
		provider: 'openai',
		model: 'gpt',
		createdAt,
	});
	await db
		.insert(messages)
		.values([
			row(`${label}-user-1`, 'user', 'complete', 1),
			row(`${label}-queued-user`, 'user', 'complete', 2),
			row(`${label}-queued`, 'assistant', 'pending', 3),
		]);
	for (const [messageId, text] of [
		[`${label}-user-1`, `${label} first`],
		[`${label}-queued-user`, `${label} queued`],
	]) {
		await db.insert(messageParts).values({
			id: crypto.randomUUID(),
			messageId,
			index: 0,
			type: 'text',
			content: JSON.stringify({ text }),
			agent: 'build',
			provider: 'openai',
			model: 'gpt',
		});
	}
	return db;
}

describe('project-scoped queue lookups', () => {
	test('history and working state never use an ambiguous unscoped queue lookup', async () => {
		const dbA = await seedProject(rootA, 'a');
		await seedProject(rootB, 'b');
		for (const [root, label] of [
			[rootA, 'a'],
			[rootB, 'b'],
		] as const) {
			enqueueAssistantRun(
				{
					sessionId,
					assistantMessageId: `${label}-queued`,
					projectRoot: root,
					agent: 'build',
					provider: 'openai',
					model: 'gpt',
				},
				async () => {},
			);
		}

		// No projectRoot option: falls back to the session's stored project.
		const history = await buildHistoryMessages(dbA, sessionId);
		const text = JSON.stringify(history);
		expect(text).toContain('a first');
		expect(text).not.toContain('a queued');

		const scoped = await buildHistoryMessages(dbA, sessionId, undefined, {
			projectRoot: rootA,
		});
		expect(JSON.stringify(scoped)).not.toContain('a queued');

		setRunning(sessionId, true, rootA);
		try {
			expect(await getRunningSessionTreeIds(dbA)).toEqual(
				new Set([sessionId, parentId]),
			);
			expect(await hasRunningSubagentDescendant(dbA, parentId)).toBe(true);
		} finally {
			setRunning(sessionId, false, rootA);
		}
		expect(await hasRunningSubagentDescendant(dbA, parentId)).toBe(false);
	});
});
