import { test, expect } from 'bun:test';
import { getDb } from '@ottocode/database';
import { messageParts, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPendingAssistantMessage } from '../packages/server/src/runtime/message/create.ts';
import { persistMemoryTurnContext } from '../packages/server/src/runtime/agent/runner/runner-memory-context.ts';
import { subscribe } from '../packages/server/src/events/bus.ts';

test('a turn persists and emits a synthetic recall and capture result', async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'otto-memory-turn-'));
	try {
		const db = await getDb(projectRoot);
		const sessionId = crypto.randomUUID();
		await db.insert(sessions).values({
			id: sessionId,
			agent: 'build',
			provider: 'anthropic',
			model: 'claude',
			projectPath: projectRoot,
			createdAt: Date.now(),
		});
		const { assistantMessageId } = await createPendingAssistantMessage({
			db,
			sessionId,
			agent: 'build',
			provider: 'anthropic',
			model: 'claude',
		});
		const record = {
			id: crypto.randomUUID(),
			content: 'We use SQLite',
			scope: 'project' as const,
			origin: 'inferred' as const,
			source: 'user:1',
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		const result = {
			recall: {
				query: 'SQLite?',
				ranking: 'typesafe' as const,
				retrieved: [record],
				injectedIds: [],
				skipped: [{ id: record.id, reason: 'already-in-message' as const }],
			},
			capture: {
				candidates: ['We use SQLite'],
				results: [
					{
						candidate: 'We use SQLite',
						status: 'created' as const,
						memory: record,
					},
				],
			},
		};
		const events: unknown[] = [];
		const unsubscribe = subscribe(
			sessionId,
			(event) => {
				if (event.type === 'tool.result') events.push(event.payload);
			},
			projectRoot,
		);
		try {
			await persistMemoryTurnContext(
				db,
				{
					sessionId,
					assistantMessageId,
					projectRoot,
					agent: 'build',
					provider: 'anthropic',
					model: 'claude',
				},
				result,
			);
		} finally {
			unsubscribe();
		}
		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, assistantMessageId));
		expect(parts).toHaveLength(1);
		expect(parts[0].toolName).toBe('memory_context');
		expect(parts[0].type).toBe('tool_result');
		const content = JSON.parse(parts[0].content);
		expect(content).toMatchObject({
			name: 'memory_context',
			synthetic: true,
			origin: 'memory_context',
			result,
		});
		expect(content.callId).toBe(parts[0].toolCallId);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			name: 'memory_context',
			callId: content.callId,
			result,
		});
	} finally {
		await rm(projectRoot, { recursive: true, force: true });
	}
});
