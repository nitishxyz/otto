import { beforeEach, describe, expect, it } from 'bun:test';
import {
	buildThreadRows,
	createThreadRowCache,
	getThreadRowType,
	resetThreadRowCache,
	sameThreadRows,
	type ThreadRow,
	type ThreadRowCache,
} from '../packages/web-sdk/src/components/messages/threadRowModel';
import {
	flattenMessagePages,
	type MessagesInfiniteData,
} from '../packages/web-sdk/src/hooks/useMessages';
import type {
	Message,
	MessagePart,
	MessagesPage,
} from '../packages/web-sdk/src/types/api';

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

/**
 * Every persisted part id the rows account for, in order. A part is either its
 * own row or a keyed entry of exactly one compact activity box.
 */
function coveredPartIds(rows: readonly ThreadRow[]) {
	const ids: string[] = [];
	for (const row of rows) {
		if (row.kind === 'assistant-item') ids.push(row.part.id);
		if (row.kind === 'assistant-compact-group') {
			for (const part of row.parts) ids.push(part.id);
		}
	}
	return ids;
}

function build(messages: Message[], options: { compact?: boolean } = {}) {
	return buildThreadRows({
		messages,
		sessionId: 'session-1',
		compact: options.compact ?? false,
		currentMessageId: null,
		queueLength: 0,
		queuedMessageIds: EMPTY,
	});
}

beforeEach(() => {
	resetThreadRowCache();
});

describe('thread row model', () => {
	it('emits one row per assistant part instead of one row per message', () => {
		const assistant = message({
			id: 'assistant-1',
			parts: [
				part({ id: 'p1', index: 0 }),
				part({ id: 'p2', index: 1 }),
				part({ id: 'p3', index: 2 }),
			],
		});
		const { rows } = build([assistant]);

		expect(rows.filter((row) => row.kind === 'assistant-item')).toHaveLength(3);
		expect(rows.some((row) => row.kind === 'assistant-header')).toBe(true);
		expect(rows.map((row) => row.key)).toEqual([
			'h:assistant-1',
			'i:p1',
			'i:p2',
			'i:p3',
			'ft:assistant-1',
		]);
	});

	it('keeps row keys stable across rebuilds so measurements survive', () => {
		const assistant = message({
			id: 'assistant-1',
			parts: [part({ id: 'p1', index: 0 })],
		});
		const first = build([assistant]).rows.map((row) => row.key);
		const streamed = message({
			...assistant,
			parts: [
				part({ id: 'p1', index: 0 }),
				part({ id: 'p2', index: 1, content: 'streaming' }),
			],
		});
		const second = build([streamed]).rows.map((row) => row.key);

		// Existing rows keep their keys; the new part only appends a new key.
		for (const key of first) expect(second).toContain(key);
		expect(second).toContain('i:p2');
		expect(second.indexOf('i:p1')).toBeLessThan(second.indexOf('i:p2'));
	});

	it('marks only the last row of a turn as the turn boundary', () => {
		const { rows } = build([
			message({
				id: 'assistant-1',
				parts: [part({ id: 'p1', index: 0 }), part({ id: 'p2', index: 1 })],
			}),
		]);

		expect(rows.filter((row) => row.endsTurn)).toHaveLength(1);
		expect(rows[rows.length - 1].endsTurn).toBe(true);
	});

	it('renders user turns as a single row and maps navigator indexes', () => {
		const user = message({
			id: 'user-1',
			role: 'user',
			parts: [part({ id: 'up1', messageId: 'user-1' })],
		});
		const assistant = message({
			id: 'assistant-1',
			parts: [part({ id: 'p1', index: 0 })],
		});
		const { rows, rowIndexByMessageIndex } = build([user, assistant]);

		expect(rows[0]).toMatchObject({ kind: 'user', key: 'u:user-1' });
		expect(rowIndexByMessageIndex).toEqual([0, 1]);
	});

	it('adds a live status row while a turn is still streaming', () => {
		const { rows } = build([
			message({
				id: 'assistant-1',
				status: 'pending',
				completedAt: null,
				parts: [],
			}),
		]);

		expect(rows.some((row) => row.kind === 'assistant-status')).toBe(true);
		expect(rows.some((row) => row.kind === 'assistant-approvals')).toBe(true);
	});

	it('skips queued assistant turns', () => {
		const { rows } = buildThreadRows({
			messages: [message({ id: 'assistant-1', status: 'pending' })],
			sessionId: 'session-1',
			compact: false,
			currentMessageId: null,
			queueLength: 0,
			queuedMessageIds: new Set(['assistant-1']),
		});

		expect(rows).toHaveLength(0);
	});
});

describe('strict one-row-per-part timeline', () => {
	const MIXED_PART_TYPES = [
		'text',
		'reasoning',
		'tool_call',
		'tool_result',
		'image',
		'file',
		'error',
	] as const;

	function mixedTurn(count: number) {
		return message({
			id: 'assistant-1',
			parts: Array.from({ length: count }, (_, index) =>
				part({
					id: `p${index}`,
					index,
					type: MIXED_PART_TYPES[index % MIXED_PART_TYPES.length],
					toolName:
						index % MIXED_PART_TYPES.length === 2 ||
						index % MIXED_PART_TYPES.length === 3
							? 'read'
							: null,
					toolCallId:
						index % MIXED_PART_TYPES.length === 2 ||
						index % MIXED_PART_TYPES.length === 3
							? `call-${index}`
							: null,
				}),
			),
		});
	}

	it('accounts for every persisted part exactly once', () => {
		for (const count of [1, 7, 40, 140]) {
			for (const compact of [false, true]) {
				resetThreadRowCache();
				const turn = mixedTurn(count);
				const { rows } = build([turn], { compact });
				const covered = coveredPartIds(rows);
				expect(covered).toEqual(
					(turn.parts ?? []).map((part) => part.id).filter((id) => id),
				);
				expect(new Set(covered).size).toBe(covered.length);
			}
		}
	});

	it('emits one row per part when nothing is compacted', () => {
		// Short, completed, roomy turn: no auto-compaction, so no grouping.
		const { rows } = build([mixedTurn(7)]);
		expect(rows.filter((row) => row.kind === 'assistant-item')).toHaveLength(7);
		expect(rows.some((row) => row.kind === 'assistant-compact-group')).toBe(
			false,
		);
	});

	it('gives every part type its own row keyed by part.id', () => {
		const { rows } = build([mixedTurn(MIXED_PART_TYPES.length)]);
		const itemRows = rows.filter((row) => row.kind === 'assistant-item');

		expect(itemRows.map((row) => row.key)).toEqual(
			MIXED_PART_TYPES.map((_, index) => `i:p${index}`),
		);
		expect(new Set(itemRows.map((row) => row.key)).size).toBe(itemRows.length);
		// Each row carries exactly one part — never a list/group of parts.
		for (const row of itemRows) {
			if (row.kind !== 'assistant-item') continue;
			expect(row.part).toBeDefined();
			expect(Array.isArray(row.part)).toBe(false);
		}
	});

	it('groups contiguous compact activity into one box only in compact mode', () => {
		const activity = message({
			id: 'assistant-1',
			parts: Array.from({ length: 12 }, (_, index) =>
				part({
					id: `t${index}`,
					index,
					type: index % 2 === 0 ? 'tool_call' : 'tool_result',
					toolName: 'read',
					toolCallId: `call-${Math.floor(index / 2)}`,
					contentJson: { result: { path: `file-${index}.ts` } },
				}),
			),
		});

		resetThreadRowCache();
		const roomy = build([activity], { compact: false }).rows;
		expect(roomy.filter((row) => row.kind === 'assistant-item')).toHaveLength(
			12,
		);
		expect(roomy.some((row) => row.kind === 'assistant-compact-group')).toBe(
			false,
		);

		resetThreadRowCache();
		const compact = build([activity], { compact: true }).rows;
		const groups = compact.filter(
			(row) => row.kind === 'assistant-compact-group',
		);
		expect(groups).toHaveLength(1);
		expect(compact.some((row) => row.kind === 'assistant-item')).toBe(false);
		expect(coveredPartIds(compact)).toEqual(
			(activity.parts ?? []).map((p) => p.id),
		);
	});

	it('does not window or hide parts on very long turns', () => {
		// Well past the old 90-item windowing threshold.
		const turn = mixedTurn(200);
		const { rows } = build([turn]);
		expect(coveredPartIds(rows)).toHaveLength(200);
		expect(rows.some((row) => row.key.startsWith('hs:'))).toBe(false);
	});

	it('keeps the persisted result row and drops the ephemeral placeholder', () => {
		const turn = message({
			id: 'assistant-1',
			parts: [
				part({
					id: 'ephemeral-tool-call-c1',
					index: 0,
					type: 'tool_call',
					toolName: 'shell',
					toolCallId: 'c1',
					ephemeral: true,
				}),
				part({
					id: 'persisted-result',
					index: 1,
					type: 'tool_result',
					toolName: 'shell',
					toolCallId: 'c1',
				}),
			],
		});
		const { rows } = build([turn]);
		const keys = rows
			.filter((row) => row.kind === 'assistant-item')
			.map((row) => row.key);

		expect(keys).toEqual(['i:persisted-result']);
	});

	it('keeps a live ephemeral action row while no persisted result exists', () => {
		const turn = message({
			id: 'assistant-1',
			status: 'pending',
			completedAt: null,
			parts: [
				part({
					id: 'ephemeral-tool-call-c1',
					index: 0,
					type: 'tool_call',
					toolName: 'shell',
					toolCallId: 'c1',
					ephemeral: true,
				}),
			],
		});
		const { rows } = build([turn]);
		const itemRows = rows.filter((row) => row.kind === 'assistant-item');

		expect(itemRows).toHaveLength(1);
		expect(itemRows[0].key).toBe('i:ephemeral-tool-call-c1');
		if (itemRows[0].kind === 'assistant-item') {
			expect(itemRows[0].variant).toBe('action');
		}
	});

	it('reuses row object identity when nothing about a row changed', () => {
		const assistant = message({
			id: 'assistant-1',
			parts: [part({ id: 'p1', index: 0 }), part({ id: 'p2', index: 1 })],
		});
		const first = build([assistant]).rows;
		const second = build([assistant]).rows;

		expect(sameThreadRows(first, second)).toBe(true);
		for (let index = 0; index < first.length; index++) {
			expect(second[index]).toBe(first[index]);
		}
	});

	it('keeps untouched row identities when an older page is prepended', () => {
		const newer = message({
			id: 'assistant-2',
			createdAt: 20,
			parts: [part({ id: 'n1', index: 0, messageId: 'assistant-2' })],
		});
		const before = build([newer]).rows;
		const beforeByKey = new Map(before.map((row) => [row.key, row]));

		const older = message({
			id: 'user-1',
			role: 'user',
			createdAt: 10,
			parts: [part({ id: 'o1', index: 0, messageId: 'user-1' })],
		});
		const after = build([older, newer]).rows;

		// Rows that existed before the prepend keep their exact identity, so the
		// list keeps their measurements and does not re-lay them out.
		for (const row of after) {
			const previous = beforeByKey.get(row.key);
			if (previous) expect(row).toBe(previous);
		}
		expect(after.some((row) => row.key === 'u:user-1')).toBe(true);
		expect(after.length).toBeGreaterThan(before.length);
	});

	it('keeps row identity per thread when two threads render side by side', () => {
		// Two threads mounted at once (subagent viewer over a session) must not
		// evict each other's cached rows; a shared cache would recreate every row
		// on every rebuild and force the list to re-measure its whole viewport.
		const threadACache = createThreadRowCache();
		const threadBCache = createThreadRowCache();
		const threadA = message({
			id: 'assistant-a',
			parts: [part({ id: 'a1', index: 0, messageId: 'assistant-a' })],
		});
		const threadB = message({
			id: 'assistant-b',
			parts: [part({ id: 'b1', index: 0, messageId: 'assistant-b' })],
		});
		const buildWith = (messages: Message[], cache: ThreadRowCache) =>
			buildThreadRows({
				messages,
				sessionId: 'session-1',
				compact: false,
				currentMessageId: null,
				queueLength: 0,
				queuedMessageIds: EMPTY,
				cache,
			}).rows;

		const firstA = buildWith([threadA], threadACache);
		buildWith([threadB], threadBCache);
		const secondA = buildWith([threadA], threadACache);

		expect(sameThreadRows(firstA, secondA)).toBe(true);
	});
});

describe('page-split turns in the row model', () => {
	it('renders one header and footer for a turn merged from three pages', () => {
		const pages: MessagesInfiniteData = {
			pages: [
				{
					items: [
						message({
							id: 'assistant-1',
							parts: [
								part({ id: 'p7', index: 7 }),
								part({ id: 'p8', index: 8 }),
								part({ id: 'p9', index: 9 }),
							],
						}),
					],
					partCount: 3,
					hasMore: true,
					nextCursor: 'cursor-2',
				},
				{
					items: [
						message({
							id: 'assistant-1',
							parts: [
								part({ id: 'p4', index: 4 }),
								part({ id: 'p5', index: 5 }),
								part({ id: 'p6', index: 6 }),
							],
						}),
					],
					partCount: 3,
					hasMore: true,
					nextCursor: 'cursor-3',
				},
				{
					items: [
						message({
							id: 'assistant-1',
							parts: [
								part({ id: 'p1', index: 1 }),
								part({ id: 'p2', index: 2 }),
								part({ id: 'p3', index: 3 }),
							],
						}),
					],
					partCount: 3,
					hasMore: false,
					nextCursor: null,
				},
			],
			pageParams: [null, 'cursor-2', 'cursor-3'],
		};

		const { rows } = build(flattenMessagePages(pages));

		expect(rows.filter((row) => row.kind === 'assistant-header')).toHaveLength(
			1,
		);
		expect(rows.filter((row) => row.kind === 'assistant-footer')).toHaveLength(
			1,
		);
		expect(
			rows.filter((row) => row.kind === 'assistant-item').map((row) => row.key),
		).toEqual([
			'i:p1',
			'i:p2',
			'i:p3',
			'i:p4',
			'i:p5',
			'i:p6',
			'i:p7',
			'i:p8',
			'i:p9',
		]);
		expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
	});
});

describe('whole-turn page prepend', () => {
	function page(
		items: Message[],
		overrides: Partial<MessagesPage> = {},
	): MessagesPage {
		return {
			items,
			partCount: items.reduce(
				(total, item) => total + (item.parts?.length ?? 0),
				0,
			),
			hasMore: true,
			nextCursor: 'cursor-older',
			...overrides,
		};
	}

	/** One complete user → assistant turn. */
	function turn(suffix: string, createdAt: number): Message[] {
		return [
			message({
				id: `user-${suffix}`,
				role: 'user',
				createdAt,
				parts: [part({ id: `u${suffix}`, messageId: `user-${suffix}` })],
			}),
			message({
				id: `assistant-${suffix}`,
				createdAt: createdAt + 1,
				parts: [
					part({
						id: `a${suffix}-1`,
						index: 0,
						messageId: `assistant-${suffix}`,
					}),
					part({
						id: `a${suffix}-2`,
						index: 1,
						messageId: `assistant-${suffix}`,
					}),
				],
			}),
		];
	}

	it('flattens latest-first pages chronologically without duplicates', () => {
		const newest = turn('3', 30);
		const middle = turn('2', 20);
		const oldest = turn('1', 10);
		const data: MessagesInfiniteData = {
			// InfiniteData stores the newest page first, older pages after it.
			pages: [
				page(newest),
				page(middle),
				page(oldest, { hasMore: false, nextCursor: null }),
			],
			pageParams: [null, 'cursor-2', 'cursor-3'],
		};

		const flat = flattenMessagePages(data);

		// Reversed page order, never reversed items inside a page.
		expect(flat.map((m) => m.id)).toEqual([
			'user-1',
			'assistant-1',
			'user-2',
			'assistant-2',
			'user-3',
			'assistant-3',
		]);
		expect(new Set(flat.map((m) => m.id)).size).toBe(flat.length);
		for (let index = 1; index < flat.length; index++) {
			expect(flat[index].createdAt).toBeGreaterThanOrEqual(
				flat[index - 1].createdAt,
			);
		}
	});

	it('keeps message and part identity when an older page is prepended', () => {
		const newest = turn('2', 20);
		const before = flattenMessagePages({
			pages: [page(newest)],
			pageParams: [null],
		});
		const after = flattenMessagePages({
			pages: [page(newest), page(turn('1', 10), { hasMore: false })],
			pageParams: [null, 'cursor-2'],
		});

		// Whole-turn pages never overlap, so the common path is a pure
		// concatenation: every already-loaded message is the same object.
		for (const message of before) {
			const next = after.find((candidate) => candidate.id === message.id);
			expect(next).toBe(message);
			expect(next?.parts).toBe(message.parts);
		}
	});

	it('preserves every pre-existing row object across the prepend', () => {
		const newest = turn('2', 20);
		const cache = createThreadRowCache();
		const buildWith = (messages: Message[]) =>
			buildThreadRows({
				messages,
				sessionId: 'session-1',
				compact: false,
				currentMessageId: null,
				queueLength: 0,
				queuedMessageIds: EMPTY,
				cache,
			}).rows;

		const before = buildWith(
			flattenMessagePages({ pages: [page(newest)], pageParams: [null] }),
		);
		const after = buildWith(
			flattenMessagePages({
				pages: [page(newest), page(turn('1', 10), { hasMore: false })],
				pageParams: [null, 'cursor-2'],
			}),
		);

		// Not one already rendered row is recreated, so LegendList keeps every
		// measurement it already has and only lays out the inserted rows.
		const afterByKey = new Map(after.map((row) => [row.key, row]));
		for (const row of before) {
			expect(afterByKey.get(row.key)).toBe(row);
		}
		expect(after.length).toBeGreaterThan(before.length);
		// The older turn's rows sit above the ones that were already loaded.
		expect(after.indexOf(before[0])).toBeGreaterThan(0);
	});
});

describe('row presentation types', () => {
	it('separates rows whose heights differ by an order of magnitude', () => {
		const rows = build([
			message({
				id: 'user-1',
				role: 'user',
				parts: [part({ id: 'u1', messageId: 'user-1' })],
			}),
			message({
				id: 'assistant-1',
				status: 'pending',
				completedAt: null,
				parts: [
					part({ id: 'p-text', index: 0, type: 'text' }),
					part({ id: 'p-reason', index: 1, type: 'reasoning' }),
					part({
						id: 'p-tool',
						index: 2,
						type: 'tool_result',
						toolName: 'read',
						toolCallId: 'c1',
					}),
					part({ id: 'p-image', index: 3, type: 'image' }),
				],
			}),
		]).rows;

		const types = rows.map(getThreadRowType);
		expect(types).toContain('user');
		expect(types).toContain('header');
		expect(types).toContain('item:text');
		expect(types).toContain('item:reasoning');
		expect(types).toContain('item:tool');
		expect(types).toContain('item:media');
		// A one-line status row must not share a size average with a paragraph.
		expect(types.some((type) => type.startsWith('status:'))).toBe(true);
		expect(new Set(types).size).toBeGreaterThan(4);
	});

	it('separates a live activity box from a collapsed summary line', () => {
		const explore = (status: Message['status']) =>
			message({
				id: 'assistant-1',
				status,
				completedAt: status === 'pending' ? null : 2,
				parts: [
					part({
						id: 'r1',
						index: 0,
						type: 'tool_result',
						toolName: 'read',
						toolCallId: 'c1',
						contentJson: { result: { path: 'a.ts' } },
					}),
					part({
						id: 'r2',
						index: 1,
						type: 'tool_result',
						toolName: 'read',
						toolCallId: 'c2',
						contentJson: { result: { path: 'b.ts' } },
					}),
				],
			});

		resetThreadRowCache();
		const live = build([explore('pending')], { compact: true }).rows.map(
			getThreadRowType,
		);
		resetThreadRowCache();
		const done = build([explore('complete')], { compact: true }).rows.map(
			getThreadRowType,
		);

		expect(live).toContain('group:live');
		expect(done).toContain('group:collapsed');
	});

	it('gives suppressed placeholders their own type', () => {
		const rows = build([
			message({
				id: 'assistant-1',
				status: 'pending',
				completedAt: null,
				parts: [
					part({
						id: 'status-call',
						index: 0,
						type: 'tool_call',
						toolName: 'update_todos',
						toolCallId: 'c1',
					}),
				],
			}),
		]).rows;

		expect(rows.map(getThreadRowType)).toContain('item:suppressed');
	});

	it('returns a stable type for the same row object', () => {
		const assistant = message({
			id: 'assistant-1',
			parts: [part({ id: 'p1', index: 0 })],
		});
		const first = build([assistant]).rows;
		const second = build([assistant]).rows;

		expect(second.map(getThreadRowType)).toEqual(first.map(getThreadRowType));
	});
});
