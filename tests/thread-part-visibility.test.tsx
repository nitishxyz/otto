import { beforeEach, describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	buildThreadRows,
	resetThreadRowCache,
	type ThreadRow,
} from '../packages/web-sdk/src/components/messages/threadRowModel';
import { AssistantItemRow } from '../packages/web-sdk/src/components/messages/ThreadRows';
import {
	getPartPresentation,
	isLiveToolCallPart,
} from '../packages/web-sdk/src/components/messages/partVisibility';
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

const EMPTY = new Set<string>();

function build(parts: MessagePart[]) {
	return buildThreadRows({
		messages: [message({ id: 'assistant-1', parts })],
		sessionId: 'session-1',
		compact: false,
		currentMessageId: null,
		queueLength: 0,
		queuedMessageIds: EMPTY,
	}).rows;
}

function itemRows(rows: readonly ThreadRow[]) {
	return rows.filter(
		(row): row is Extract<ThreadRow, { kind: 'assistant-item' }> =>
			row.kind === 'assistant-item',
	);
}

function rowForPart(parts: MessagePart[], partId: string) {
	const row = itemRows(build(parts)).find((item) => item.key === `i:${partId}`);
	if (!row) throw new Error(`no row emitted for part ${partId}`);
	return row;
}

/** Renders a row exactly as MessageThread wires it up. */
function renderItemRow(row: Extract<ThreadRow, { kind: 'assistant-item' }>) {
	return renderToStaticMarkup(
		<AssistantItemRow
			messageId={row.messageId}
			part={row.part}
			variant={row.variant}
			showLine={row.showLine}
			isFirstPart={row.isFirstPart}
			isLiveToolCall={row.isLiveToolCall}
			isLastMessage={row.isLastMessage}
			canRetry={row.canRetry}
			sessionId="session-1"
			compact={false}
		/>,
	);
}

beforeEach(() => {
	resetThreadRowCache();
});

/**
 * Every persisted part type the API can produce, paired with whether the
 * timeline shows its content. Suppressed parts still get a row.
 */
const PART_CASES: Array<{
	name: string;
	part: MessagePart;
	presentation: 'visible' | 'suppressed';
}> = [
	{
		name: 'text with content',
		part: part({ id: 'text-visible', type: 'text' }),
		presentation: 'visible',
	},
	{
		name: 'empty text',
		part: part({
			id: 'text-empty',
			type: 'text',
			content: JSON.stringify({ text: '' }),
			contentJson: { text: '' },
		}),
		presentation: 'suppressed',
	},
	{
		name: 'whitespace-only text',
		part: part({
			id: 'text-blank',
			type: 'text',
			content: JSON.stringify({ text: '   \n  ' }),
			contentJson: { text: '   \n  ' },
		}),
		presentation: 'suppressed',
	},
	{
		name: 'reasoning with content',
		part: part({
			id: 'reasoning-visible',
			type: 'reasoning',
			content: JSON.stringify({ text: 'thinking' }),
			contentJson: { text: 'thinking' },
		}),
		presentation: 'visible',
	},
	{
		name: 'empty reasoning',
		part: part({
			id: 'reasoning-empty',
			type: 'reasoning',
			content: JSON.stringify({ text: '' }),
			contentJson: { text: '' },
		}),
		presentation: 'suppressed',
	},
	{
		name: 'unresolved tool_call',
		part: part({
			id: 'call-open',
			type: 'tool_call',
			toolName: 'read',
			toolCallId: 'open-1',
			contentJson: { args: { path: 'a.ts' } },
		}),
		presentation: 'visible',
	},
	{
		name: 'progress_update tool_call',
		part: part({
			id: 'call-progress',
			type: 'tool_call',
			toolName: 'progress_update',
			toolCallId: 'progress-1',
			contentJson: { args: { message: 'working' } },
		}),
		presentation: 'suppressed',
	},
	{
		name: 'update_todos tool_call',
		part: part({
			id: 'call-todos',
			type: 'tool_call',
			toolName: 'update_todos',
			toolCallId: 'todos-1',
			contentJson: { args: {} },
		}),
		presentation: 'suppressed',
	},
	{
		// `git_status` stands in for "any ordinary tool result". Renderers that
		// syntax-highlight (read/tree/…) need a real DOM, so they are covered by
		// the model assertions below rather than by the markup ones.
		name: 'tool_result',
		part: part({
			id: 'result-tool',
			type: 'tool_result',
			toolName: 'git_status',
			toolCallId: 'git-1',
			contentJson: { result: { ok: true, files: [] } },
		}),
		presentation: 'visible',
	},
	{
		name: 'progress_update tool_result',
		part: part({
			id: 'result-progress',
			type: 'tool_result',
			toolName: 'progress_update',
			toolCallId: 'progress-2',
			contentJson: { result: { message: 'still working' } },
		}),
		presentation: 'suppressed',
	},
	{
		name: 'update_todos tool_result',
		part: part({
			id: 'result-todos',
			type: 'tool_result',
			toolName: 'update_todos',
			toolCallId: 'todos-2',
			contentJson: { result: { todos: [] } },
		}),
		presentation: 'suppressed',
	},
	{
		name: 'error',
		part: part({
			id: 'error-1',
			type: 'error',
			content: JSON.stringify({ message: 'boom' }),
			contentJson: { message: 'boom' },
		}),
		presentation: 'visible',
	},
	{
		name: 'file',
		part: part({
			id: 'file-1',
			type: 'file',
			content: JSON.stringify({ name: 'a.pdf' }),
			contentJson: { name: 'a.pdf', mediaType: 'application/pdf' },
		}),
		presentation: 'visible',
	},
	{
		name: 'image',
		part: part({
			id: 'image-1',
			type: 'image',
			content: JSON.stringify({ name: 'a.png' }),
			contentJson: { name: 'a.png', mediaType: 'image/png' },
		}),
		presentation: 'visible',
	},
];

describe('persisted part visibility', () => {
	it('classifies every supported part type without dropping any', () => {
		for (const testCase of PART_CASES) {
			expect(
				getPartPresentation(testCase.part, { resolvedToolCallIds: EMPTY }),
			).toBe(testCase.presentation);
		}
	});

	it('shows tool results whose renderers need a browser DOM', () => {
		// These use syntax highlighting, so they cannot be server-rendered here;
		// what matters for row sizing is that the model still marks them visible.
		for (const toolName of ['read', 'tree', 'write', 'apply_patch']) {
			const row = rowForPart(
				[
					part({
						id: `result-${toolName}`,
						type: 'tool_result',
						toolName,
						toolCallId: `${toolName}-1`,
						contentJson: { result: { path: 'a.ts', content: 'x' } },
					}),
				],
				`result-${toolName}`,
			);
			expect(row.variant).not.toBe('suppressed');
			resetThreadRowCache();
		}
	});

	it('emits exactly one row per part, whatever its type or visibility', () => {
		const parts = PART_CASES.map((testCase, index) => ({
			...testCase.part,
			index,
		}));
		const rows = itemRows(build(parts));

		expect(rows).toHaveLength(PART_CASES.length);
		expect(rows.map((row) => row.key)).toEqual(
			PART_CASES.map((testCase) => `i:${testCase.part.id}`),
		);
		expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
	});

	it('marks suppressed parts with a dedicated variant instead of dropping them', () => {
		const parts = PART_CASES.map((testCase, index) => ({
			...testCase.part,
			index,
		}));
		const rows = itemRows(build(parts));

		for (const [index, testCase] of PART_CASES.entries()) {
			const row = rows[index];
			expect(row.key).toBe(`i:${testCase.part.id}`);
			if (testCase.presentation === 'suppressed') {
				expect(row.variant).toBe('suppressed');
			} else {
				expect(row.variant).not.toBe('suppressed');
			}
		}
	});

	it('stops the timeline connector at the last part that draws something', () => {
		const visibleText = part({ id: 'text-1', index: 0, type: 'text' });
		const trailingProgress = part({
			id: 'progress-1',
			index: 1,
			type: 'tool_result',
			toolName: 'progress_update',
			toolCallId: 'p1',
			contentJson: { result: { message: 'done' } },
		});

		// Without this the connector would trail off the last visible part into
		// the suppressed placeholder below it.
		expect(rowForPart([visibleText, trailingProgress], 'text-1').showLine).toBe(
			false,
		);
		resetThreadRowCache();
		expect(
			rowForPart(
				[visibleText, trailingProgress, part({ id: 'text-2', index: 2 })],
				'text-1',
			).showLine,
		).toBe(true);
	});

	it('never draws a timeline connector from a suppressed row', () => {
		const parts = PART_CASES.map((testCase, index) => ({
			...testCase.part,
			index,
		}));
		for (const row of itemRows(build(parts))) {
			if (row.variant === 'suppressed') expect(row.showLine).toBe(false);
		}
	});
});

describe('every part row renders a measurable element', () => {
	it('produces non-empty markup for every supported part type', () => {
		for (const testCase of PART_CASES) {
			resetThreadRowCache();
			const row = rowForPart([testCase.part], testCase.part.id);
			const markup = renderItemRow(row);
			expect(markup).not.toBe('');
			expect(markup.startsWith('<')).toBe(true);
		}
	});

	it('gives suppressed parts an inert placeholder with a fixed non-zero height', () => {
		const suppressed = PART_CASES.filter(
			(testCase) => testCase.presentation === 'suppressed',
		);
		expect(suppressed.length).toBeGreaterThan(0);

		for (const testCase of suppressed) {
			resetThreadRowCache();
			const markup = renderItemRow(
				rowForPart([testCase.part], testCase.part.id),
			);
			expect(markup).toContain(`data-suppressed-part="${testCase.part.id}"`);
			expect(markup).toContain('height:1px');
			expect(markup).toContain('aria-hidden="true"');
		}
	});

	it('renders real content for every visible part type', () => {
		const visible = PART_CASES.filter(
			(testCase) => testCase.presentation === 'visible',
		);
		for (const testCase of visible) {
			resetThreadRowCache();
			const markup = renderItemRow(
				rowForPart([testCase.part], testCase.part.id),
			);
			expect(markup).not.toContain('data-suppressed-part');
			// Visible parts always render at least the timeline icon column, which
			// is far taller than the suppressed placeholder.
			expect(markup.length).toBeGreaterThan(50);
		}
	});
});

describe('tool_call rows keep a stable height at the live edge', () => {
	const call = part({
		id: 'call-1',
		index: 0,
		type: 'tool_call',
		toolName: 'read',
		toolCallId: 'c1',
		contentJson: { args: { path: 'a.ts' } },
	});
	const laterText = part({ id: 'later-text', index: 1, type: 'text' });
	const evenLaterText = part({ id: 'later-text-2', index: 2, type: 'text' });
	const result = part({
		id: 'result-1',
		index: 3,
		type: 'tool_result',
		toolName: 'read',
		toolCallId: 'c1',
		contentJson: { result: { path: 'a.ts' } },
	});

	it('stays visible when the call stops being the last part', () => {
		// The old rule keyed this on "is this the last part", so any unrelated
		// part streaming in collapsed the call row from a full box to nothing.
		expect(rowForPart([call], 'call-1').variant).toBe('part');
		resetThreadRowCache();
		expect(rowForPart([call, laterText], 'call-1').variant).toBe('part');
		resetThreadRowCache();
		expect(rowForPart([call, laterText, evenLaterText], 'call-1').variant).toBe(
			'part',
		);
	});

	it('keeps every height-affecting field stable across the last → not-last transition', () => {
		const before = rowForPart([call], 'call-1');
		const after = itemRows(build([call, laterText])).find(
			(row) => row.key === 'i:call-1',
		);
		if (!after || after.kind !== 'assistant-item') {
			throw new Error('call row disappeared when a later part arrived');
		}

		expect(after.part).toBe(before.part);
		expect(after.variant).toBe(before.variant);
		expect(after.isLiveToolCall).toBe(before.isLiveToolCall);
		// The only difference is the timeline connector, which is absolutely
		// positioned and therefore cannot change the row's measured height.
		expect(before.showLine).toBe(false);
		expect(after.showLine).toBe(true);
	});

	it('suppresses the call exactly once, when its own result lands', () => {
		expect(rowForPart([call, laterText, evenLaterText], 'call-1').variant).toBe(
			'part',
		);
		resetThreadRowCache();
		const resolved = rowForPart(
			[call, laterText, evenLaterText, result],
			'call-1',
		);
		expect(resolved.variant).toBe('suppressed');
		expect(resolved.isLiveToolCall).toBe(false);
	});

	it('keeps parallel calls live until each one resolves', () => {
		const callA = part({
			id: 'call-a',
			index: 0,
			type: 'tool_call',
			toolName: 'read',
			toolCallId: 'a',
		});
		const callB = part({
			id: 'call-b',
			index: 1,
			type: 'tool_call',
			toolName: 'read',
			toolCallId: 'b',
		});
		const resultB = part({
			id: 'result-b',
			index: 2,
			type: 'tool_result',
			toolName: 'read',
			toolCallId: 'b',
		});
		const parts = [callA, callB, resultB];

		expect(rowForPart(parts, 'call-a').variant).toBe('part');
		expect(rowForPart(parts, 'call-b').variant).toBe('suppressed');
	});

	it('reports live state from the call result, not from part order', () => {
		expect(isLiveToolCallPart(call, { resolvedToolCallIds: EMPTY })).toBe(true);
		expect(
			isLiveToolCallPart(call, { resolvedToolCallIds: new Set(['c1']) }),
		).toBe(false);
	});
});
