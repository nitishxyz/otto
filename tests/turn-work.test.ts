import { beforeEach, describe, expect, it } from 'bun:test';
import {
	buildThreadRows,
	resetThreadRowCache,
} from '../packages/web-sdk/src/components/messages/threadRowModel';
import {
	getTrailingAnswerStartIndex,
	hasCollapsibleWork,
	isCollapsibleWorkPart,
	shouldHidePartWhenWorkCollapsed,
} from '../packages/web-sdk/src/components/messages/turnWork';
import type { Message, MessagePart } from '../packages/web-sdk/src/types/api';

function part(overrides: Partial<MessagePart> & { id: string }): MessagePart {
	return {
		messageId: 'assistant-1',
		index: 0,
		stepIndex: null,
		type: 'text',
		content: JSON.stringify({ text: 'hello' }),
		agent: 'build',
		provider: 'anthropic',
		model: 'sonnet',
		startedAt: 1,
		completedAt: 2,
		toolName: null,
		toolCallId: null,
		toolDurationMs: null,
		...overrides,
	};
}

function message(overrides: Partial<Message> & { id: string }): Message {
	return {
		sessionId: 'session-1',
		role: 'assistant',
		status: 'complete',
		agent: 'build',
		provider: 'anthropic',
		model: 'sonnet',
		createdAt: 1,
		completedAt: 2,
		latencyMs: null,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts: [],
		...overrides,
	};
}

function toolResult(id: string, index: number, callId = id): MessagePart {
	return part({
		id,
		index,
		type: 'tool_result',
		toolName: 'read',
		toolCallId: callId,
		contentJson: { result: { path: `${id}.ts` } },
	});
}

const EMPTY = new Set<string>();
const emptyWork = {
	resolvedToolCallIds: new Set<string>(),
	completedActionToolCallIds: new Set<string>(),
};

function build(
	messages: Message[],
	options: { expanded?: ReadonlySet<string> } = {},
) {
	return buildThreadRows({
		messages,
		sessionId: 'session-1',
		compact: false,
		currentMessageId: null,
		queueLength: 0,
		queuedMessageIds: EMPTY,
		expandedWorkMessageIds: options.expanded,
	});
}

beforeEach(() => {
	resetThreadRowCache();
});

describe('turn work helpers', () => {
	it('treats tool results and reasoning as work, not closing text', () => {
		const text = part({ id: 't', type: 'text' });
		const reasoning = part({
			id: 'r',
			type: 'reasoning',
			content: JSON.stringify({ text: 'thinking' }),
			contentJson: { text: 'thinking' },
		});
		const tool = toolResult('tool', 0);

		expect(isCollapsibleWorkPart(text, emptyWork)).toBe(false);
		expect(isCollapsibleWorkPart(reasoning, emptyWork)).toBe(true);
		expect(isCollapsibleWorkPart(tool, emptyWork)).toBe(true);
	});

	it('starts the closing answer after the last work part', () => {
		const parts = [
			toolResult('w1', 0),
			part({ id: 'mid', index: 1 }),
			toolResult('w2', 2),
			part({ id: 'final', index: 3 }),
		];
		expect(getTrailingAnswerStartIndex(parts, emptyWork)).toBe(3);
		expect(hasCollapsibleWork(parts, emptyWork)).toBe(true);
		expect(shouldHidePartWhenWorkCollapsed(parts[1], 1, 3, emptyWork)).toBe(
			true,
		);
		expect(shouldHidePartWhenWorkCollapsed(parts[3], 3, 3, emptyWork)).toBe(
			false,
		);
	});
});

describe('collapsed older turns', () => {
	const older = message({
		id: 'assistant-1',
		parts: [
			toolResult('old-tool', 0),
			part({
				id: 'old-mid',
				index: 1,
				content: JSON.stringify({ text: 'working…' }),
			}),
			toolResult('old-tool-2', 2),
			part({
				id: 'old-final',
				index: 3,
				content: JSON.stringify({ text: 'Done.' }),
			}),
		],
	});
	const latest = message({
		id: 'assistant-2',
		createdAt: 3,
		parts: [
			toolResult('new-tool', 0, 'new-tool'),
			part({
				id: 'new-final',
				index: 1,
				messageId: 'assistant-2',
				content: JSON.stringify({ text: 'Latest answer' }),
			}),
		],
	});

	it('hides older tool work behind Show Work and keeps the closing text', () => {
		const { rows } = build([older, latest]);
		const olderKeys = rows
			.filter((row) => row.messageId === 'assistant-1')
			.map((row) => row.key);

		expect(olderKeys).toContain('sw:assistant-1');
		expect(olderKeys).toContain('i:old-final');
		expect(olderKeys).not.toContain('i:old-tool');
		expect(olderKeys).not.toContain('i:old-mid');
		expect(olderKeys).not.toContain('i:old-tool-2');
	});

	it('keeps the latest turn fully expanded', () => {
		const { rows } = build([older, latest]);
		const latestKeys = rows
			.filter((row) => row.messageId === 'assistant-2')
			.map((row) => row.key);

		expect(latestKeys).not.toContain('sw:assistant-2');
		expect(latestKeys).toContain('i:new-tool');
		expect(latestKeys).toContain('i:new-final');
	});

	it('restores older tool rows when the reader expands Show Work', () => {
		const { rows } = build([older, latest], {
			expanded: new Set(['assistant-1']),
		});
		const olderKeys = rows
			.filter((row) => row.messageId === 'assistant-1')
			.map((row) => row.key);

		expect(olderKeys).toContain('sw:assistant-1');
		expect(olderKeys).toContain('i:old-tool');
		expect(olderKeys).toContain('i:old-mid');
		expect(olderKeys).toContain('i:old-tool-2');
		expect(olderKeys).toContain('i:old-final');
		expect(rows.find((row) => row.key === 'sw:assistant-1')).toMatchObject({
			expanded: true,
		});
	});

	it('does not add Show Work to a text-only older turn', () => {
		const textOnly = message({
			id: 'assistant-1',
			parts: [part({ id: 'only-text' })],
		});
		const { rows } = build([textOnly, latest]);
		expect(rows.some((row) => row.key === 'sw:assistant-1')).toBe(false);
		expect(rows.some((row) => row.key === 'i:only-text')).toBe(true);
	});
});
