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
import {
	compactSubagent,
	getSubagentStatus,
	readSubagentActivity,
} from '../packages/server/src/runtime/subagents/service.ts';
import { loadConfig } from '@ottocode/sdk';

let projectRoot = '';
const parentSessionId = 'inspection-parent';
const childSessionId = 'inspection-child';
const subagentId = 'inspection-subagent';

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'otto-subagent-inspection-'));
	const db = await getDb(projectRoot);
	const now = Date.now();
	await db.insert(sessions).values([
		{
			id: parentSessionId,
			agent: 'otto',
			provider: 'test-provider',
			model: 'test-parent-model',
			projectPath: projectRoot,
			createdAt: now,
			sessionType: 'main',
		},
		{
			id: childSessionId,
			agent: 'plan',
			provider: 'test-provider',
			model: 'model-with-no-catalog-entry',
			projectPath: projectRoot,
			createdAt: now,
			parentSessionId,
			sessionType: 'subagent',
			currentContextTokens: 12_345,
			totalInputTokens: 20_000,
			totalOutputTokens: 2_000,
			totalToolTimeMs: 900,
			toolCountsJson: JSON.stringify({ read: 2, shell: 1 }),
		},
	]);
	await db.insert(subagents).values({
		id: subagentId,
		parentSessionId,
		childSessionId,
		agent: 'plan',
		task: 'Inspect the implementation',
		status: 'running',
		summary: null,
		reported: false,
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(messages).values({
		id: 'inspection-message',
		sessionId: childSessionId,
		role: 'assistant',
		status: 'pending',
		agent: 'plan',
		provider: 'test-provider',
		model: 'model-with-no-catalog-entry',
		createdAt: now + 1,
	});
	await db
		.insert(messageParts)
		.values([
			toolCall('call-1', 0, 'read', { path: 'old.ts' }, now + 2),
			toolResult('call-1', 1, { ok: true, content: 'old' }, now + 3),
			toolCall('call-2', 2, 'search', { query: 'subagent' }, now + 4),
			toolResult('call-2', 3, { ok: false, error: 'not found' }, now + 5),
			toolCall('call-3', 4, 'shell', { cmd: 'bun test' }, now + 6),
		]);
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
});

describe('subagent inspection', () => {
	test('reports context and aggregate usage without consuming the result', async () => {
		const db = await getDb(projectRoot);
		const result = await getSubagentStatus({
			db,
			parentSessionId,
			subagentId,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.subagent.context).toEqual({
			usedTokens: 12_345,
			windowTokens: null,
			remainingTokens: null,
			percentUsed: null,
			lastCompactedAt: null,
		});
		expect(result.subagent.usage.toolCalls).toBe(3);
		expect(result.subagent.execution).toEqual({
			isRunning: false,
			currentMessageId: null,
			queuedMessages: 0,
		});

		const rows = await db
			.select({ reported: subagents.reported })
			.from(subagents)
			.where(eq(subagents.id, subagentId));
		expect(rows[0]?.reported).toBe(false);
	});

	test('returns a bounded newest-first overview and pairs tool results', async () => {
		const db = await getDb(projectRoot);
		const result = await readSubagentActivity({
			db,
			parentSessionId,
			subagentId,
			limit: 2,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.activity).toHaveLength(2);
		expect(result.activity[0]).toMatchObject({
			toolCallId: 'call-3',
			tool: 'shell',
			status: 'running',
			input: '{"cmd":"bun test"}',
		});
		expect(result.activity[1]).toMatchObject({
			toolCallId: 'call-2',
			tool: 'search',
			status: 'failed',
			input: '{"query":"subagent"}',
			result: '{"ok":false,"error":"not found"}',
		});
	});

	test('rejects records owned by another parent session', async () => {
		const db = await getDb(projectRoot);
		const result = await getSubagentStatus({
			db,
			parentSessionId: 'different-parent',
			subagentId,
		});
		expect(result.ok).toBe(false);
	});

	test('does not compact over active delegated work', async () => {
		const db = await getDb(projectRoot);
		const cfg = await loadConfig(projectRoot);
		const result = await compactSubagent({
			db,
			cfg,
			parentSessionId,
			subagentId,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('still running');
	});
});

function toolCall(
	callId: string,
	index: number,
	name: string,
	args: Record<string, unknown>,
	startedAt: number,
) {
	return {
		id: `${callId}-call`,
		messageId: 'inspection-message',
		index,
		stepIndex: index / 2,
		type: 'tool_call',
		content: JSON.stringify({ name, args, callId }),
		agent: 'plan',
		provider: 'test-provider',
		model: 'model-with-no-catalog-entry',
		startedAt,
		completedAt: null,
		toolName: name,
		toolCallId: callId,
		toolDurationMs: null,
	};
}

function toolResult(
	callId: string,
	index: number,
	result: Record<string, unknown>,
	completedAt: number,
) {
	return {
		id: `${callId}-result`,
		messageId: 'inspection-message',
		index,
		stepIndex: (index - 1) / 2,
		type: 'tool_result',
		content: JSON.stringify({ name: 'tool', result, callId }),
		agent: 'plan',
		provider: 'test-provider',
		model: 'model-with-no-catalog-entry',
		startedAt: completedAt - 1,
		completedAt,
		toolName: 'tool',
		toolCallId: callId,
		toolDurationMs: 1,
	};
}
