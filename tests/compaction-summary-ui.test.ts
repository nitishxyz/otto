import { describe, expect, it } from 'bun:test';
import type { Message, MessagePart } from '../packages/web-sdk/src/types/api';
import {
	getUserMessageText,
	isCompactionSummaryText,
	shouldRenderCompactionSummaryBox,
	summarizeCompactionText,
} from '../packages/web-sdk/src/components/messages/compactionSummary';

function textPart(text: string): MessagePart {
	return {
		id: 'part-1',
		messageId: 'msg-1',
		index: 0,
		stepIndex: 0,
		type: 'text',
		content: JSON.stringify({ text }),
		agent: 'assistant',
		provider: 'openai',
		model: 'gpt-4',
		startedAt: 1,
		completedAt: 2,
		toolName: null,
		toolCallId: null,
		toolDurationMs: null,
	};
}

describe('compaction summary UI helpers', () => {
	it('detects compaction summary text by header', () => {
		expect(
			isCompactionSummaryText('📦 **Context Compacted**\n\nCurrent state: foo'),
		).toBe(true);
	});

	it('renders compaction box after /compact user command in compact mode', () => {
		const previousUserMessage: Message = {
			id: 'user-1',
			sessionId: 's1',
			role: 'user',
			status: 'complete',
			agent: 'default',
			provider: 'openai',
			model: 'gpt-4',
			createdAt: 1,
			completedAt: 1,
			latencyMs: null,
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			error: null,
			parts: [
				{
					...textPart('/compact'),
					messageId: 'user-1',
				},
			],
		};

		expect(
			shouldRenderCompactionSummaryBox({
				compact: true,
				part: textPart('Some summary without the exact header'),
				previousUserMessage,
			}),
		).toBe(true);
	});

	it('does not render compaction box outside compact thread mode', () => {
		expect(
			shouldRenderCompactionSummaryBox({
				compact: false,
				part: textPart('📦 **Context Compacted**'),
				previousUserMessage: {
					id: 'user-1',
					sessionId: 's1',
					role: 'user',
					status: 'complete',
					agent: 'default',
					provider: 'openai',
					model: 'gpt-4',
					createdAt: 1,
					completedAt: 1,
					latencyMs: null,
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					error: null,
					parts: [textPart('/compact')],
				},
			}),
		).toBe(false);
	});

	it('summarizes collapsed compaction line', () => {
		expect(
			summarizeCompactionText(
				'📦 **Context Compacted**\n\nCurrent state: working on thread UI',
			),
		).toBe('Current state: working on thread UI');
	});

	it('reads user message text from parts', () => {
		const user: Message = {
			id: 'user-1',
			sessionId: 's1',
			role: 'user',
			status: 'complete',
			agent: 'default',
			provider: 'openai',
			model: 'gpt-4',
			createdAt: 1,
			completedAt: 1,
			latencyMs: null,
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			error: null,
			parts: [textPart('/compact')],
		};
		expect(getUserMessageText(user)).toBe('/compact');
	});
});