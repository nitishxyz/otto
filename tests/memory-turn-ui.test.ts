import { describe, expect, test } from 'bun:test';
import { deriveAssistantTurn } from '../packages/web-sdk/src/components/messages/assistantTurnModel.ts';
import {
	formatMemorySummaryLabel,
	getMemoryTurnSummary,
	isMemoryContextPart,
} from '../packages/web-sdk/src/components/messages/memoryTurnModel.ts';
import { buildThreadRows } from '../packages/web-sdk/src/components/messages/threadRowModel.ts';
import type {
	Message,
	MessagePart,
} from '../packages/web-sdk/src/types/api.ts';

function part(
	id: string,
	index: number,
	type: MessagePart['type'],
	toolName: string | null,
	contentJson: Record<string, unknown>,
): MessagePart {
	return {
		id,
		messageId: 'assistant-1',
		index,
		stepIndex: null,
		type,
		content: JSON.stringify(contentJson),
		contentJson,
		agent: 'build',
		provider: 'anthropic',
		model: 'claude',
		startedAt: 1,
		completedAt: 2,
		toolName,
		toolCallId: toolName ? `${id}-call` : null,
		toolDurationMs: 1,
	};
}

function message(parts: MessagePart[]): Message {
	return {
		id: 'assistant-1',
		sessionId: 'session-1',
		role: 'assistant',
		status: 'complete',
		agent: 'build',
		provider: 'anthropic',
		model: 'claude',
		createdAt: 1,
		completedAt: 2,
		latencyMs: 1,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts,
	};
}

const memoryA = {
	id: 'aaaaaaaa-0000-4000-8000-000000000001',
	content: 'I prefer tabs over spaces',
	scope: 'project',
	origin: 'explicit',
	source: 'user request',
};
const memoryB = {
	id: 'bbbbbbbb-0000-4000-8000-000000000002',
	content: 'We use Bun for everything',
	scope: 'global',
	origin: 'inferred',
	source: 'user turn before assistant x',
};
const memoryC = {
	id: 'cccccccc-0000-4000-8000-000000000003',
	content: 'Loosely related note',
	scope: 'project',
	origin: 'explicit',
	source: 'user request',
};

const syntheticMemoryResult = part(
	'mem-ctx',
	0,
	'tool_result',
	'memory_context',
	{
		name: 'memory_context',
		callId: 'mem-ctx-call',
		synthetic: true,
		origin: 'memory_context',
		result: {
			recall: {
				query: 'tabs or spaces?',
				ranking: 'typesafe',
				retrieved: [memoryA, memoryB, memoryC],
				injectedIds: [memoryA.id, memoryB.id],
			},
			capture: {
				candidates: [
					'I always use tabs in this repository',
					'I like coffee today',
				],
				results: [
					{
						candidate: 'I always use tabs in this repository',
						status: 'updated',
						memory: {
							...memoryA,
							content: 'I always use tabs in this repository',
						},
					},
				],
			},
		},
	},
);

describe('memory turn UI model', () => {
	test('distinguishes retrieved from injected and proposed from persisted', () => {
		expect(isMemoryContextPart(syntheticMemoryResult)).toBe(true);
		const summary = getMemoryTurnSummary([syntheticMemoryResult]);
		if (!summary) throw new Error('expected a memory summary');
		expect(summary?.retrievedCount).toBe(3);
		expect(summary?.injectedCount).toBe(2);
		expect(summary?.recall?.ranking).toBe('typesafe');
		expect(summary?.recall?.entries.map((entry) => entry.injected)).toEqual([
			true,
			true,
			false,
		]);
		expect(summary?.writes).toHaveLength(2);
		expect(summary?.writes[0]).toMatchObject({
			status: 'updated',
			origin: 'inferred',
			scope: 'project',
			content: 'I always use tabs in this repository',
		});
		expect(summary?.writes[1]).toMatchObject({
			status: 'skipped',
			origin: 'inferred',
			content: 'I like coffee today',
		});
		expect(summary?.savedCount).toBe(0);
		expect(summary?.updatedCount).toBe(1);
		expect(summary?.skippedCount).toBe(1);
		expect(formatMemorySummaryLabel(summary)).toBe(
			'Used 2 memories · Updated 1 · Skipped 1',
		);
	});

	test('counts explicit remember and forget_memory tool results', () => {
		const rememberOk = part('rem-1', 0, 'tool_result', 'remember', {
			name: 'remember',
			args: {
				content: 'Deploy with wrangler',
				scope: 'project',
				source: 'user request',
			},
			result: {
				status: 'created',
				memory: {
					id: 'dddddddd-0000-4000-8000-000000000004',
					content: 'Deploy with wrangler',
					scope: 'project',
					origin: 'explicit',
					source: 'user request',
				},
			},
		});
		const rememberRejected = part('rem-2', 1, 'tool_result', 'remember', {
			name: 'remember',
			args: { content: 'api_key = abc123', scope: 'global', source: 'x' },
			result: { status: 'rejected', reason: 'credential-like content' },
		});
		const forget = part('forget-1', 2, 'tool_result', 'forget_memory', {
			name: 'forget_memory',
			args: { id: memoryC.id },
			result: { forgotten: true },
		});
		const summary = getMemoryTurnSummary([
			rememberOk,
			rememberRejected,
			forget,
		]);
		if (!summary) throw new Error('expected a memory summary');
		expect(summary?.recall).toBeNull();
		expect(summary?.writes.map((write) => write.status)).toEqual([
			'created',
			'rejected',
			'forgotten',
		]);
		expect(summary?.writes.every((write) => write.origin === 'explicit')).toBe(
			true,
		);
		expect(summary?.writes[1].reason).toBe('credential-like content');
		expect(formatMemorySummaryLabel(summary)).toBe(
			'Saved 1 · Forgot 1 · Skipped 1',
		);
	});

	test('returns null for turns without memory activity', () => {
		const text = part('text', 0, 'text', null, { text: 'Hello' });
		const read = part('read', 1, 'tool_result', 'read', {
			name: 'read',
			args: { path: 'a.ts' },
			result: { ok: true },
		});
		expect(getMemoryTurnSummary([text, read])).toBeNull();
		const emptyContext = part('mem-empty', 2, 'tool_result', 'memory_context', {
			name: 'memory_context',
			synthetic: true,
			origin: 'memory_context',
			result: { recall: { retrieved: [], injectedIds: [] } },
		});
		expect(getMemoryTurnSummary([emptyContext])).toBeNull();
	});

	test('hides the synthetic part and emits a memory thread row', () => {
		const text: MessagePart = {
			...part('text', 1, 'text', null, { text: 'Done.' }),
			toolCallId: null,
		};
		const msg = message([syntheticMemoryResult, text]);
		const model = deriveAssistantTurn(msg, {});
		expect(model.memoryActivity?.injectedCount).toBe(2);
		expect(model.renderItems).toHaveLength(1);
		expect(model.renderItems[0]).toMatchObject({
			kind: 'part',
			part: { id: 'text' },
		});

		const thread = buildThreadRows({
			messages: [msg],
			compact: false,
			currentMessageId: null,
			queueLength: 0,
			queuedMessageIds: new Set(),
		});
		const memoryRow = thread.rows.find(
			(row) => row.kind === 'assistant-memory',
		);
		expect(memoryRow).toMatchObject({
			kind: 'assistant-memory',
			showLine: true,
			summary: { injectedCount: 2, retrievedCount: 3 },
		});
		expect(
			thread.rows.some(
				(row) => row.kind === 'assistant-item' && row.part.id === 'mem-ctx',
			),
		).toBe(false);
	});
});
