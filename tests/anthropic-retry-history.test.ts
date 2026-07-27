import { describe, expect, test } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureUserTurnBeforeAssistantRun } from '../packages/server/src/runtime/agent/runner/runner-messages.ts';
import { buildHistoryMessages } from '../packages/server/src/runtime/message/history-builder.ts';

describe('assistant retry history', () => {
	test('excludes retained parts from the assistant message being retried', async () => {
		const projectRoot = mkdtempSync(join(tmpdir(), 'otto-retry-history-'));
		const db = await getDb(projectRoot);
		const now = Date.now();

		await db.insert(sessions).values({
			id: 'retry-session',
			agent: 'build',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			projectPath: projectRoot,
			createdAt: now,
			lastActiveAt: now,
		});
		await db.insert(messages).values([
			{
				id: 'retry-user',
				sessionId: 'retry-session',
				role: 'user',
				status: 'complete',
				agent: 'build',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				createdAt: now,
			},
			{
				id: 'retry-assistant',
				sessionId: 'retry-session',
				role: 'assistant',
				status: 'pending',
				agent: 'build',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				createdAt: now + 1,
			},
		]);
		await db.insert(messageParts).values([
			{
				id: 'retry-user-part',
				messageId: 'retry-user',
				index: 0,
				type: 'text',
				content: JSON.stringify({ text: 'Fix the bug' }),
				agent: 'build',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
			},
			{
				id: 'retry-assistant-part',
				messageId: 'retry-assistant',
				index: 0,
				type: 'text',
				content: JSON.stringify({ text: 'Partial failed response' }),
				agent: 'build',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
			},
		]);

		const history = await buildHistoryMessages(
			db,
			'retry-session',
			'retry-assistant',
		);

		expect(history).toEqual([
			{
				role: 'user',
				content: [{ type: 'text', text: 'Fix the bug' }],
			},
		]);
	});

	test('adds a user continuation after a compaction assistant turn', () => {
		const messages = ensureUserTurnBeforeAssistantRun([
			{ role: 'user', content: 'Fix the bug' },
			{ role: 'assistant', content: 'Compacted conversation summary' },
		]);

		expect(messages.at(-1)).toEqual({
			role: 'user',
			content:
				'Continue the task from the current state. Do not repeat work already completed.',
		});
	});

	test('adds a user continuation when a checkpoint leaves an empty tail', () => {
		expect(ensureUserTurnBeforeAssistantRun([])).toEqual([
			{
				role: 'user',
				content:
					'Continue the task from the current state. Do not repeat work already completed.',
			},
		]);
	});

	test('adds a user continuation after an OAuth system message', () => {
		const messages = ensureUserTurnBeforeAssistantRun([
			{
				role: 'system',
				content: 'Compacted conversation summary',
			},
		]);

		expect(messages.at(-1)).toEqual({
			role: 'user',
			content:
				'Continue the task from the current state. Do not repeat work already completed.',
		});
	});

	test('leaves a user-ended conversation unchanged', () => {
		const messages = [{ role: 'user' as const, content: 'Fix the bug' }];
		expect(ensureUserTurnBeforeAssistantRun(messages)).toBe(messages);
	});
});
