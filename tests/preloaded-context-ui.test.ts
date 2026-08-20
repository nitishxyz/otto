import { describe, expect, test } from 'bun:test';
import {
	deriveAssistantTurn,
	getPreloadedContextSummary,
} from '../packages/web-sdk/src/components/messages/assistantTurnModel.ts';
import type {
	Message,
	MessagePart,
} from '../packages/web-sdk/src/types/api.ts';
import { buildThreadRows } from '../packages/web-sdk/src/components/messages/threadRowModel.ts';

function part(
	id: string,
	index: number,
	type: MessagePart['type'],
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
		agent: 'plan',
		provider: 'anthropic',
		model: 'claude',
		startedAt: 1,
		completedAt: 2,
		toolName: 'read',
		toolCallId: 'context-read-1',
		toolDurationMs: 1,
	};
}

const contextMetadata = {
	fileCount: 1,
	requestedFileCount: 2,
	deduplicatedFileCount: 1,
	totalBytes: 512,
	preloadDurationMs: 7,
	completedAt: 2,
};

const syntheticCall = part('call', 0, 'tool_call', {
	name: 'read',
	args: { path: 'src/example.ts', startLine: 3, endLine: 9 },
	callId: 'context-read-1',
	synthetic: true,
	origin: 'message_context',
	context: contextMetadata,
});
const syntheticResult = part('result', 1, 'tool_result', {
	name: 'read',
	args: { path: 'src/example.ts', startLine: 3, endLine: 9 },
	result: { ok: true, path: 'src/example.ts', content: 'example' },
	callId: 'context-read-1',
	synthetic: true,
	origin: 'message_context',
	context: contextMetadata,
});

describe('preloaded context UI model', () => {
	test('summarizes synthetic context and hides raw tool rows', () => {
		const textPart: MessagePart = {
			...part('text', 2, 'text', { text: 'Done.' }),
			toolName: null,
			toolCallId: null,
			content: JSON.stringify({ text: 'Done.' }),
			contentJson: { text: 'Done.' },
		};
		const message: Message = {
			id: 'assistant-1',
			sessionId: 'session-1',
			role: 'assistant',
			status: 'complete',
			agent: 'plan',
			provider: 'anthropic',
			model: 'claude',
			createdAt: 1,
			completedAt: 2,
			latencyMs: 1,
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			error: null,
			parts: [syntheticCall, syntheticResult, textPart],
		};

		expect(getPreloadedContextSummary(message.parts ?? [])).toEqual({
			files: [{ path: 'src/example.ts', lineRange: '3-9' }],
			totalBytes: 512,
			preloadDurationMs: 7,
			deduplicatedFileCount: 1,
		});
		const model = deriveAssistantTurn(message, {});
		expect(model.preloadedContext?.files).toHaveLength(1);
		expect(model.renderItems).toHaveLength(1);
		expect(model.renderItems[0]).toMatchObject({
			kind: 'part',
			part: { id: 'text' },
		});
		const thread = buildThreadRows({
			messages: [message],
			compact: false,
			currentMessageId: null,
			queueLength: 0,
			queuedMessageIds: new Set(),
		});
		expect(thread.rows.some((row) => row.kind === 'assistant-context')).toBe(
			true,
		);
		expect(
			thread.rows.some(
				(row) =>
					row.kind === 'assistant-item' &&
					(row.part.id === 'call' || row.part.id === 'result'),
			),
		).toBe(false);
	});
});
