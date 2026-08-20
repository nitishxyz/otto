import { describe, expect, it } from 'bun:test';
import {
	buildThreadRows,
	createThreadRowCache,
	type ThreadRow,
	type ThreadRowCache,
} from '../packages/web-sdk/src/components/messages/threadRowModel';
import { AUTO_COMPACT_COMPLETED_PART_THRESHOLD } from '../packages/web-sdk/src/components/messages/assistantTurnModel';
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

function toolPart(id: string, index: number): MessagePart {
	return part({
		id,
		index,
		type: 'tool_result',
		toolName: 'read',
		toolCallId: `call-${id}`,
		content: JSON.stringify({ name: 'read', args: { path: `${id}.ts` } }),
		contentJson: { name: 'read', args: { path: `${id}.ts` } },
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
const settled: Message[] = [
	message({
		id: 'user-1',
		role: 'user',
		parts: [part({ id: 'u1', messageId: 'user-1' })],
	}),
];

/** A turn big enough to cross the auto-compact threshold on completion. */
function bigTurnParts(): MessagePart[] {
	const parts: MessagePart[] = [];
	for (let i = 0; i < AUTO_COMPACT_COMPLETED_PART_THRESHOLD; i++) {
		parts.push(toolPart(`a2-r${i}`, i));
	}
	parts.push(part({ id: 'a2-answer', index: parts.length }));
	return parts;
}

function build(
	messages: Message[],
	cache: ThreadRowCache,
	currentMessageId: string | null = null,
) {
	return buildThreadRows({
		messages,
		sessionId: 'session-1',
		compact: false,
		currentMessageId,
		queueLength: 0,
		queuedMessageIds: EMPTY,
		cache,
	}).rows;
}

const keys = (rows: readonly ThreadRow[]) => rows.map((row) => row.key);

describe('pending -> complete transition of a large turn', () => {
	it('keeps the expanded per-part rows when a watched turn completes', () => {
		const cache = createThreadRowCache();
		const parts = bigTurnParts();
		const pending = message({
			id: 'assistant-2',
			status: 'pending',
			createdAt: 4,
			parts,
		});
		const before = build([...settled, pending], cache, 'assistant-2');
		const beforeByKey = new Map(before.map((row) => [row.key, row]));
		const partKeys = keys(before).filter((key) => key.startsWith('i:'));
		expect(partKeys.length).toBeGreaterThan(
			AUTO_COMPACT_COMPLETED_PART_THRESHOLD,
		);

		const complete = message({
			id: 'assistant-2',
			status: 'complete',
			createdAt: 4,
			completedAt: 9,
			parts,
		});
		const after = build([...settled, complete], cache);
		const afterKeys = new Set(keys(after));

		// The representation must not flip: every expanded part row survives
		// the completion instant, so LegendList keeps its measured sizes and
		// the MVCP anchor for whatever the reader is looking at.
		for (const key of partKeys) expect(afterKeys.has(key)).toBe(true);
		expect(after.some((row) => row.kind === 'assistant-compact-group')).toBe(
			false,
		);

		// Only the live tail chrome may change: status/approvals leave, the
		// turn footer arrives.
		const beforeKeySet = new Set(keys(before));
		const removed = [...beforeKeySet].filter((key) => !afterKeys.has(key));
		const added = [...afterKeys].filter((key) => !beforeKeySet.has(key));
		expect(removed.sort()).toEqual(['ap:assistant-2', 'st:assistant-2']);
		expect(added).toEqual(['ft:assistant-2']);

		// Untouched part rows keep their exact object identity.
		for (const row of after) {
			if (!row.key.startsWith('i:') || row.key === 'i:a2-answer') continue;
			if (row.endsTurn) continue;
			const previous = beforeByKey.get(row.key);
			if (previous && !previous.endsTurn) expect(row).toBe(previous);
		}
	});

	it('still auto-compacts a large turn that was first seen complete', () => {
		const cache = createThreadRowCache();
		const complete = message({
			id: 'assistant-2',
			status: 'complete',
			createdAt: 4,
			completedAt: 9,
			parts: bigTurnParts(),
		});
		const rows = build([...settled, complete], cache);
		expect(rows.some((row) => row.kind === 'assistant-compact-group')).toBe(
			true,
		);
	});

	it('drops the expansion latch when the turn leaves the thread', () => {
		const cache = createThreadRowCache();
		const parts = bigTurnParts();
		const pending = message({
			id: 'assistant-2',
			status: 'pending',
			createdAt: 4,
			parts,
		});
		build([...settled, pending], cache, 'assistant-2');
		expect(cache.liveTurnIds.has('assistant-2')).toBe(true);

		// Session switch: the turn is no longer in the built thread.
		build(
			[
				message({
					id: 'user-9',
					role: 'user',
					parts: [part({ id: 'u9', messageId: 'user-9' })],
				}),
			],
			cache,
		);
		expect(cache.liveTurnIds.has('assistant-2')).toBe(false);

		// Re-encountering the turn later (already complete) auto-compacts.
		const complete = message({
			id: 'assistant-2',
			status: 'complete',
			createdAt: 4,
			completedAt: 9,
			parts,
		});
		const rows = build([...settled, complete], cache);
		expect(rows.some((row) => row.kind === 'assistant-compact-group')).toBe(
			true,
		);
	});

	it('keeps a small watched turn unchanged (no latch side effects)', () => {
		const cache = createThreadRowCache();
		const parts = [toolPart('a2-r1', 0), part({ id: 'a2-answer', index: 1 })];
		const pending = message({
			id: 'assistant-2',
			status: 'pending',
			createdAt: 4,
			parts,
		});
		const before = build([...settled, pending], cache, 'assistant-2');
		const complete = message({
			id: 'assistant-2',
			status: 'complete',
			createdAt: 4,
			completedAt: 9,
			parts,
		});
		const after = build([...settled, complete], cache);
		const beforeKeySet = new Set(keys(before));
		const afterKeys = new Set(keys(after));
		const removed = [...beforeKeySet].filter((key) => !afterKeys.has(key));
		const added = [...afterKeys].filter((key) => !beforeKeySet.has(key));
		expect(removed.sort()).toEqual(['ap:assistant-2', 'st:assistant-2']);
		expect(added).toEqual(['ft:assistant-2']);
	});
});
