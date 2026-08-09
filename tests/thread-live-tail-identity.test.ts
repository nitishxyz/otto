import { describe, expect, it } from 'bun:test';
import {
	buildThreadRows,
	createThreadRowCache,
	getThreadRowType,
	type ThreadRow,
	type ThreadRowCache,
} from '../packages/web-sdk/src/components/messages/threadRowModel';
import type { Message, MessagePart } from '../packages/web-sdk/src/types/api';

function part(overrides: Partial<MessagePart> & { id: string }): MessagePart {
	return {
		messageId: 'assistant-2',
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

function readPart(id: string, path: string, index: number): MessagePart {
	return part({
		id,
		index,
		type: 'tool_result',
		toolName: 'read',
		toolCallId: `call-${id}`,
		content: JSON.stringify({ name: 'read', args: { path } }),
		contentJson: { name: 'read', args: { path } },
	});
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

function build(messages: Message[], cache: ThreadRowCache, compact: boolean) {
	return buildThreadRows({
		messages,
		sessionId: 'session-1',
		compact,
		currentMessageId: null,
		queueLength: 0,
		queuedMessageIds: EMPTY,
		cache,
	}).rows;
}

/** Applies one streamed part exactly like the stream engine does. */
function appendPart(live: Message, next: MessagePart): Message {
	return { ...live, parts: [...(live.parts ?? []), next] };
}

function rowsByKey(rows: readonly ThreadRow[]) {
	return new Map(rows.map((row) => [row.key, row]));
}

const keyOf = (row: ThreadRow) => row.key;

/** Live chrome: mounted only while a turn runs, and always at the tail. */
const CHROME_KINDS = new Set(['assistant-approvals', 'assistant-status']);

function contentRows(rows: readonly ThreadRow[]) {
	return rows.filter((row) => !CHROME_KINDS.has(row.kind));
}

function isChromeAtTail(rows: readonly ThreadRow[]) {
	const firstChrome = rows.findIndex((row) => CHROME_KINDS.has(row.kind));
	if (firstChrome === -1) return true;
	return rows.slice(firstChrome).every((row) => CHROME_KINDS.has(row.kind));
}

/**
 * The settled part of the thread: an earlier complete turn plus the user turn
 * that started the live one. The objects are created once, exactly like the
 * cache keeps them: a streamed delta only replaces the live message.
 */
const SETTLED_MESSAGES: Message[] = [
	message({
		id: 'user-1',
		role: 'user',
		parts: [part({ id: 'u1-text', messageId: 'user-1' })],
	}),
	message({
		id: 'assistant-1',
		parts: [
			part({ id: 'a1-p1', messageId: 'assistant-1' }),
			part({ id: 'a1-p2', messageId: 'assistant-1', index: 1 }),
		],
	}),
	message({
		id: 'user-2',
		role: 'user',
		createdAt: 3,
		parts: [part({ id: 'u2-text', messageId: 'user-2' })],
	}),
];

describe('streaming appends below the viewport', () => {
	it('keeps every settled row identical while the live turn grows', () => {
		const cache = createThreadRowCache();
		let live = message({
			id: 'assistant-2',
			status: 'pending',
			createdAt: 4,
			parts: [part({ id: 'a2-p1' })],
		});
		const before = build([...SETTLED_MESSAGES, live], cache, false);
		const settledKeys = ['u:user-1', 'h:assistant-1', 'i:a1-p1', 'i:a1-p2'];
		const beforeByKey = rowsByKey(before);

		for (let index = 2; index <= 6; index++) {
			live = appendPart(live, part({ id: `a2-p${index}`, index: index - 1 }));
			const after = build([...SETTLED_MESSAGES, live], cache, false);
			const afterByKey = rowsByKey(after);

			for (const key of settledKeys) {
				expect(afterByKey.get(key)).toBe(beforeByKey.get(key) as ThreadRow);
			}
			// The live turn's own header keeps its identity too: only parts below
			// it changed.
			expect(afterByKey.get('h:assistant-2')).toBe(
				beforeByKey.get('h:assistant-2') as ThreadRow,
			);
			// Content rows are appended, never reordered or re-keyed: the
			// previous sequence stays a prefix of the new one, and the live
			// chrome (approvals/status) stays at the very tail.
			const beforeContent = contentRows(before);
			const afterContent = contentRows(after);
			expect(afterContent.slice(0, beforeContent.length).map(keyOf)).toEqual(
				beforeContent.map(keyOf),
			);
			expect(
				afterContent.slice(0, beforeContent.length).map(getThreadRowType),
			).toEqual(beforeContent.map(getThreadRowType));
			expect(isChromeAtTail(after)).toBe(true);
		}
	});

	it('reuses the exact same row objects when nothing changed at all', () => {
		const cache = createThreadRowCache();
		const messages = SETTLED_MESSAGES;
		const first = build(messages, cache, false);
		const second = build(messages, cache, false);
		expect(second.length).toBe(first.length);
		for (const [index, row] of second.entries()) {
			expect(row).toBe(first[index]);
		}
	});

	it('keeps the live status row stable across deltas that do not touch it', () => {
		const cache = createThreadRowCache();
		const statusPart = part({
			id: 'a2-progress',
			type: 'tool_result',
			toolName: 'progress_update',
			content: JSON.stringify({
				name: 'progress_update',
				args: { message: 'x' },
			}),
			contentJson: { name: 'progress_update', args: { message: 'x' } },
		});
		let live = message({
			id: 'assistant-2',
			status: 'pending',
			createdAt: 4,
			parts: [part({ id: 'a2-p1' }), statusPart],
		});
		const before = rowsByKey(build([...SETTLED_MESSAGES, live], cache, false));
		expect(before.get('st:assistant-2')).toBeDefined();

		live = appendPart(live, part({ id: 'a2-p2', index: 2 }));
		const after = rowsByKey(build([...SETTLED_MESSAGES, live], cache, false));
		expect(after.get('st:assistant-2')).toBe(
			before.get('st:assistant-2') as ThreadRow,
		);
	});

	it('appends the live status row at the tail, never above existing rows', () => {
		const cache = createThreadRowCache();
		const live = message({
			id: 'assistant-2',
			status: 'pending',
			createdAt: 4,
			parts: [part({ id: 'a2-p1' })],
		});
		const rows = build([...SETTLED_MESSAGES, live], cache, false);
		const tail = rows[rows.length - 1];
		expect(['assistant-status', 'assistant-approvals']).toContain(tail.kind);
		expect(rows.findIndex((row) => row.kind === 'assistant-status')).toBe(
			rows.length - 1,
		);
	});
});

describe('compact activity groups during streaming', () => {
	it('does not re-key or replace preceding rows when the live group grows', () => {
		const cache = createThreadRowCache();
		// A finished run, a text part that closes it, then the live run.
		let live = message({
			id: 'assistant-2',
			status: 'pending',
			createdAt: 4,
			parts: [
				readPart('a2-r1', 'a.ts', 0),
				readPart('a2-r2', 'b.ts', 1),
				part({ id: 'a2-text', index: 2 }),
				readPart('a2-r3', 'c.ts', 3),
			],
		});
		const before = build([...SETTLED_MESSAGES, live], cache, true);
		const beforeByKey = rowsByKey(before);
		const stableKeys = [
			'u:user-1',
			'h:assistant-1',
			'h:assistant-2',
			'cg:a2-r1',
			'i:a2-text',
		];
		for (const key of stableKeys) expect(beforeByKey.has(key)).toBe(true);
		expect(beforeByKey.get('cg:a2-r1')).toMatchObject({ collapsed: true });
		expect(beforeByKey.get('cg:a2-r3')).toMatchObject({ collapsed: false });

		for (const [index, path] of ['d.ts', 'e.ts', 'f.ts'].entries()) {
			live = appendPart(live, readPart(`a2-r${index + 4}`, path, index + 4));
			const after = build([...SETTLED_MESSAGES, live], cache, true);
			const afterByKey = rowsByKey(after);

			for (const key of stableKeys) {
				expect(afterByKey.get(key)).toBe(beforeByKey.get(key) as ThreadRow);
			}
			// The live run keeps one row keyed on its first part: appending never
			// adds a row and never re-keys the group.
			expect(
				after.filter((row) => row.kind === 'assistant-compact-group'),
			).toHaveLength(2);
			expect(afterByKey.has('cg:a2-r3')).toBe(true);
			expect(after.map((row) => row.key)).toEqual(before.map((row) => row.key));
		}
	});

	it('keeps the collapsed/live group types stable above the live tail', () => {
		const cache = createThreadRowCache();
		let live = message({
			id: 'assistant-2',
			status: 'pending',
			createdAt: 4,
			parts: [
				readPart('a2-r1', 'a.ts', 0),
				part({ id: 'a2-text', index: 1 }),
				readPart('a2-r2', 'b.ts', 2),
			],
		});
		const before = build([...SETTLED_MESSAGES, live], cache, true);
		const typesBefore = before.map(
			(row) => `${row.key}:${getThreadRowType(row)}`,
		);

		live = appendPart(live, readPart('a2-r3', 'c.ts', 3));
		const after = build([...SETTLED_MESSAGES, live], cache, true);
		expect(after.map((row) => `${row.key}:${getThreadRowType(row)}`)).toEqual(
			typesBefore,
		);
	});
});
