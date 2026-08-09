import { describe, expect, it } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import {
	MESSAGE_PARTS_PAGE_TARGET,
	flattenMessagePages,
	getMessagesFromCache,
	getMessagesQueryKey,
	getOlderMessagesCursor,
	normalizeMessagesInfiniteData,
	updateMessagesCache,
	type MessagesInfiniteData,
} from '../packages/web-sdk/src/hooks/useMessages';
import { reconcileRefetchedPage } from '../packages/web-sdk/src/hooks/messagePageMerge';
import type {
	Message,
	MessagePart,
	MessagesPage,
} from '../packages/web-sdk/src/types/api';

function message(
	id: string,
	createdAt: number,
	overrides: Partial<Message> = {},
): Message {
	return {
		id,
		sessionId: 'session-1',
		role: 'user',
		status: 'complete',
		agent: 'build',
		provider: 'anthropic',
		model: 'sonnet',
		createdAt,
		completedAt: createdAt,
		latencyMs: null,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts: [],
		...overrides,
	};
}

function part(
	id: string,
	index: number,
	overrides: Partial<MessagePart> = {},
): MessagePart {
	return {
		id,
		messageId: 'assistant-1',
		index,
		stepIndex: null,
		type: 'text',
		content: JSON.stringify({ text: id }),
		agent: 'build',
		provider: 'anthropic',
		model: 'sonnet',
		startedAt: index,
		completedAt: index,
		toolName: null,
		toolCallId: null,
		toolDurationMs: null,
		...overrides,
	};
}

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
		hasMore: false,
		nextCursor: null,
		...overrides,
	};
}

function pagedData(): MessagesInfiniteData {
	return {
		pages: [
			page([message('c', 3), message('d', 4)], {
				hasMore: true,
				nextCursor: 'cursor-b',
			}),
			page([message('a', 1), message('b', 2)]),
		],
		pageParams: [null, 'cursor-b'],
	};
}

/**
 * One assistant turn whose nine parts were split across three part-bounded
 * pages. Pages are stored newest-first, so page 0 carries the newest parts.
 */
function splitTurnData(): MessagesInfiniteData {
	const assistant = (parts: MessagePart[], overrides: Partial<Message> = {}) =>
		message('assistant-1', 10, {
			role: 'assistant',
			parts,
			...overrides,
		});
	return {
		pages: [
			page([assistant([part('p7', 7), part('p8', 8), part('p9', 9)])], {
				hasMore: true,
				nextCursor: 'cursor-2',
			}),
			page([assistant([part('p4', 4), part('p5', 5), part('p6', 6)])], {
				hasMore: true,
				nextCursor: 'cursor-3',
			}),
			page([
				message('user-1', 9, {
					parts: [part('u1', 0, { messageId: 'user-1' })],
				}),
				assistant([part('p1', 1), part('p2', 2), part('p3', 3)]),
			]),
		],
		pageParams: [null, 'cursor-2', 'cursor-3'],
	};
}

describe('paged message cache', () => {
	it('migrates a legacy flat cache without reading pages from undefined', () => {
		const legacy = [message('a', 1), message('b', 2)];
		const normalized = normalizeMessagesInfiniteData(legacy);

		expect(normalized?.pages).toHaveLength(1);
		expect(normalized?.pages[0]?.items).toBe(legacy);
		expect(normalized?.pageParams).toEqual([null]);
		expect(flattenMessagePages(legacy).map((item) => item.id)).toEqual([
			'a',
			'b',
		]);
	});

	it('upgrades a legacy flat cache before an optimistic message update', () => {
		const client = new QueryClient();
		client.setQueryData(getMessagesQueryKey('session-1'), [message('a', 1)]);

		updateMessagesCache(client, 'session-1', (messages) => [
			...messages,
			message('b', 2),
		]);

		const data = client.getQueryData<MessagesInfiniteData>(
			getMessagesQueryKey('session-1'),
		);
		expect(data?.pages[0]?.items.map((item) => item.id)).toEqual(['a', 'b']);
		expect(getOlderMessagesCursor(client, 'session-1')).toBeNull();
	});

	it('flattens newest-first pages into chronological order', () => {
		expect(flattenMessagePages(pagedData()).map((m) => m.id)).toEqual([
			'a',
			'b',
			'c',
			'd',
		]);
	});

	it('appends new messages to the newest page', () => {
		const client = new QueryClient();
		client.setQueryData(getMessagesQueryKey('session-1'), pagedData());

		updateMessagesCache(client, 'session-1', (messages) => [
			...messages,
			message('e', 5),
		]);

		const data = client.getQueryData<MessagesInfiniteData>(
			getMessagesQueryKey('session-1'),
		);
		expect(data?.pages[0].items.map((m) => m.id)).toEqual(['c', 'd', 'e']);
		expect(data?.pages[1].items.map((m) => m.id)).toEqual(['a', 'b']);
		expect(getMessagesFromCache(client, 'session-1')?.map((m) => m.id)).toEqual(
			['a', 'b', 'c', 'd', 'e'],
		);
	});

	it('keeps older-page messages in their original page when updated', () => {
		const client = new QueryClient();
		client.setQueryData(getMessagesQueryKey('session-1'), pagedData());

		updateMessagesCache(client, 'session-1', (messages) =>
			messages.map((m) =>
				m.id === 'a' ? { ...m, status: 'error' as const } : m,
			),
		);

		const data = client.getQueryData<MessagesInfiniteData>(
			getMessagesQueryKey('session-1'),
		);
		expect(data?.pages[1].items.map((m) => m.id)).toEqual(['a', 'b']);
		expect(data?.pages[1].items[0].status).toBe('error');
	});

	it('drops removed messages and leaves untouched pages identical', () => {
		const client = new QueryClient();
		const initial = pagedData();
		client.setQueryData(getMessagesQueryKey('session-1'), initial);

		updateMessagesCache(client, 'session-1', (messages) =>
			messages.filter((m) => m.id !== 'd'),
		);

		const data = client.getQueryData<MessagesInfiniteData>(
			getMessagesQueryKey('session-1'),
		);
		expect(data?.pages[0].items.map((m) => m.id)).toEqual(['c']);
		expect(data?.pages[1]).toBe(initial.pages[1]);
	});

	it('ignores updates for sessions that were never fetched', () => {
		const client = new QueryClient();
		updateMessagesCache(client, 'session-1', (messages) => [
			...messages,
			message('x', 9),
		]);
		expect(getMessagesFromCache(client, 'session-1')).toBeUndefined();
	});
});

/**
 * Whole-turn pages: the route selects complete user→assistant turns, so
 * consecutive pages never share a message and never split one.
 */
function turnPagedData(): MessagesInfiniteData {
	const olderUser = message('user-1', 1, {
		parts: [part('u1', 0, { messageId: 'user-1' })],
	});
	const olderAssistant = message('assistant-1', 2, {
		role: 'assistant',
		parts: [part('a1', 0), part('a2', 1)],
	});
	const newerUser = message('user-2', 3, {
		parts: [part('u2', 0, { messageId: 'user-2' })],
	});
	const newerAssistant = message('assistant-2', 4, {
		role: 'assistant',
		parts: [part('b1', 0, { messageId: 'assistant-2' })],
	});
	return {
		pages: [
			page([newerUser, newerAssistant], {
				hasMore: true,
				nextCursor: 'cursor-older',
			}),
			page([olderUser, olderAssistant]),
		],
		pageParams: [null, 'cursor-older'],
	};
}

describe('whole-turn pages', () => {
	it('never repeats a message across pages', () => {
		const data = turnPagedData();
		const ids = data.pages.flatMap((p) => p.items.map((m) => m.id));
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('keeps every message object identical when an older page is prepended', () => {
		const newestOnly: MessagesInfiniteData = {
			pages: [turnPagedData().pages[0]],
			pageParams: [null],
		};
		const before = flattenMessagePages(newestOnly);
		const withOlder: MessagesInfiniteData = {
			pages: [newestOnly.pages[0], turnPagedData().pages[1]],
			pageParams: [null, 'cursor-older'],
		};
		const after = flattenMessagePages(withOlder);

		expect(after.map((m) => m.id)).toEqual([
			'user-1',
			'assistant-1',
			'user-2',
			'assistant-2',
		]);
		// Nothing already on screen is recreated: the merge hands back the exact
		// same message objects, so rows keep their identity and measurements.
		for (const previous of before) {
			expect(after).toContain(previous);
		}
		// Parts keep identity too.
		const previousParts = before.flatMap((m) => m.parts ?? []);
		const nextParts = after.flatMap((m) => m.parts ?? []);
		for (const previous of previousParts) {
			expect(nextParts).toContain(previous);
		}
	});

	it('leaves the older page untouched when the live turn updates', () => {
		const client = new QueryClient();
		const initial = turnPagedData();
		client.setQueryData(getMessagesQueryKey('session-1'), initial);

		updateMessagesCache(client, 'session-1', (messages) =>
			messages.map((m) =>
				m.id === 'assistant-2'
					? { ...m, parts: [...(m.parts ?? []), part('b2', 1)] }
					: m,
			),
		);

		const data = client.getQueryData<MessagesInfiniteData>(
			getMessagesQueryKey('session-1'),
		);
		expect(data?.pages[1]).toBe(initial.pages[1]);
		expect(data?.pages[0].items[1].parts?.map((p) => p.id)).toEqual([
			'b1',
			'b2',
		]);
		expect(data?.pages[0].partCount).toBe(3);
	});

	it('collapses a duplicated id defensively instead of rendering it twice', () => {
		// A widened refetch of the newest page can pull in a turn the older page
		// already holds; that must never produce two entries for one message.
		const shared = message('assistant-1', 2, {
			role: 'assistant',
			parts: [part('a1', 0), part('a2', 1)],
		});
		const merged = flattenMessagePages({
			pages: [
				page([{ ...shared, status: 'error' }], {
					hasMore: true,
					nextCursor: 'cursor-older',
				}),
				page([
					message('user-1', 1, {
						parts: [part('u1', 0, { messageId: 'user-1' })],
					}),
					shared,
				]),
			],
			pageParams: [null, 'cursor-older'],
		});

		expect(merged.map((m) => m.id)).toEqual(['user-1', 'assistant-1']);
		expect(merged[1].status).toBe('error');
		expect(merged[1].parts?.map((p) => p.id)).toEqual(['a1', 'a2']);
	});
});

describe('legacy split pages are still merged defensively', () => {
	it('merges a message split across three pages into one ordered message', () => {
		const merged = flattenMessagePages(splitTurnData());

		expect(merged.map((m) => m.id)).toEqual(['user-1', 'assistant-1']);
		const assistant = merged[1];
		expect(assistant.parts?.map((p) => p.id)).toEqual([
			'p1',
			'p2',
			'p3',
			'p4',
			'p5',
			'p6',
			'p7',
			'p8',
			'p9',
		]);
	});

	it('never yields duplicate parent entries or duplicate parts', () => {
		const merged = flattenMessagePages(splitTurnData());
		const ids = merged.map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);

		const partIds = merged[1].parts?.map((p) => p.id) ?? [];
		expect(new Set(partIds).size).toBe(partIds.length);
	});

	it('prefers the newest page copy for parent metadata', () => {
		const data = splitTurnData();
		data.pages[0].items[0] = {
			...data.pages[0].items[0],
			status: 'pending',
			completedAt: null,
		};
		// Older pages still carry the stale completed copy.
		expect(data.pages[2].items[1].status).toBe('complete');

		const merged = flattenMessagePages(data);
		expect(merged[1].status).toBe('pending');
		expect(merged[1].parts).toHaveLength(9);
	});

	it('returns stable object identities while pages are unchanged', () => {
		const data = splitTurnData();
		const first = flattenMessagePages(data);
		const second = flattenMessagePages(data);
		expect(second[1]).toBe(first[1]);

		// A structurally identical clone of the same pages must reuse the same
		// merged message, so row memoization survives cache reads.
		const cloned: MessagesInfiniteData = {
			...data,
			pages: [...data.pages],
		};
		expect(flattenMessagePages(cloned)[1]).toBe(first[1]);
	});

	it('keeps every loaded part when a stream update appends a new one', () => {
		const client = new QueryClient();
		client.setQueryData(getMessagesQueryKey('session-1'), splitTurnData());

		// Mirrors the stream engine: rewrite the merged message with one more part.
		updateMessagesCache(client, 'session-1', (messages) =>
			messages.map((m) =>
				m.id === 'assistant-1'
					? { ...m, parts: [...(m.parts ?? []), part('p10', 10)] }
					: m,
			),
		);

		const data = client.getQueryData<MessagesInfiniteData>(
			getMessagesQueryKey('session-1'),
		);
		// The turn is consolidated onto the page that owns it (the newest copy),
		// because pages can no longer split a message.
		expect(data?.pages[0].items[0].parts?.map((p) => p.id)).toEqual([
			'p1',
			'p2',
			'p3',
			'p4',
			'p5',
			'p6',
			'p7',
			'p8',
			'p9',
			'p10',
		]);
		expect(data?.pages[0].partCount).toBe(10);
		// No page holds a second copy of the same message.
		const ids = data?.pages.flatMap((p) => p.items.map((m) => m.id)) ?? [];
		expect(new Set(ids).size).toBe(ids.length);

		const merged = getMessagesFromCache(client, 'session-1');
		expect(merged).toHaveLength(2);
		expect(merged?.[1].parts?.map((p) => p.id)).toEqual([
			'p1',
			'p2',
			'p3',
			'p4',
			'p5',
			'p6',
			'p7',
			'p8',
			'p9',
			'p10',
		]);
	});

	it('keeps every loaded part when a stream update rewrites parent status', () => {
		const client = new QueryClient();
		client.setQueryData(getMessagesQueryKey('session-1'), splitTurnData());

		updateMessagesCache(client, 'session-1', (messages) =>
			messages.map((m) =>
				m.id === 'assistant-1'
					? { ...m, status: 'complete' as const, completedAt: 99 }
					: m,
			),
		);

		const merged = getMessagesFromCache(client, 'session-1');
		expect(merged?.[1].completedAt).toBe(99);
		expect(merged?.[1].parts).toHaveLength(9);
	});

	it('updates a part in place without duplicating it across pages', () => {
		const client = new QueryClient();
		client.setQueryData(getMessagesQueryKey('session-1'), splitTurnData());

		// Streaming deltas mutate parts that may live on an older page.
		updateMessagesCache(client, 'session-1', (messages) =>
			messages.map((m) =>
				m.id === 'assistant-1'
					? {
							...m,
							parts: (m.parts ?? []).map((p) =>
								p.id === 'p2' ? { ...p, content: 'updated' } : p,
							),
						}
					: m,
			),
		);

		const data = client.getQueryData<MessagesInfiniteData>(
			getMessagesQueryKey('session-1'),
		);
		const partIds =
			data?.pages.flatMap((p) =>
				p.items.flatMap((m) => (m.parts ?? []).map((part) => part.id)),
			) ?? [];
		expect(new Set(partIds).size).toBe(partIds.length);

		const merged = getMessagesFromCache(client, 'session-1');
		expect(merged?.[1].parts).toHaveLength(9);
		expect(merged?.[1].parts?.find((p) => p.id === 'p2')?.content).toBe(
			'updated',
		);
	});

	it('drops parts removed by retry from whichever page held them', () => {
		const client = new QueryClient();
		client.setQueryData(getMessagesQueryKey('session-1'), splitTurnData());

		updateMessagesCache(client, 'session-1', (messages) =>
			messages.map((m) =>
				m.id === 'assistant-1'
					? { ...m, parts: (m.parts ?? []).filter((p) => p.id !== 'p2') }
					: m,
			),
		);

		const merged = getMessagesFromCache(client, 'session-1');
		expect(merged?.[1].parts?.map((p) => p.id)).not.toContain('p2');
		expect(merged?.[1].parts).toHaveLength(8);
		const data = client.getQueryData<MessagesInfiniteData>(
			getMessagesQueryKey('session-1'),
		);
		const totalParts =
			data?.pages.reduce((total, p) => total + p.partCount, 0) ?? 0;
		// user-1 keeps its single part; the assistant turn keeps eight.
		expect(totalParts).toBe(9);
	});

	it('keeps optimistic sends and pending assistants without parts', () => {
		const client = new QueryClient();
		client.setQueryData(getMessagesQueryKey('session-1'), splitTurnData());

		updateMessagesCache(client, 'session-1', (messages) => [
			...messages,
			message('optimistic-user-1', 11, {
				status: 'pending',
				optimistic: 'sending',
				parts: [part('opt-1', 0, { messageId: 'optimistic-user-1' })],
			}),
			message('assistant-2', 12, {
				role: 'assistant',
				status: 'pending',
				completedAt: null,
				parts: [],
			}),
		]);

		const merged = getMessagesFromCache(client, 'session-1');
		expect(merged?.map((m) => m.id)).toEqual([
			'user-1',
			'assistant-1',
			'optimistic-user-1',
			'assistant-2',
		]);
		expect(merged?.[3].parts).toEqual([]);
		const data = client.getQueryData<MessagesInfiniteData>(
			getMessagesQueryKey('session-1'),
		);
		expect(data?.pages[0].items.map((m) => m.id)).toEqual([
			'assistant-1',
			'optimistic-user-1',
			'assistant-2',
		]);
	});
});

describe('older page cursor', () => {
	it('targets the documented soft part budget', () => {
		// The route treats `limit` as a soft target and finishes the turn it is
		// in, so this must stay well under the server's hard safety cap.
		expect(MESSAGE_PARTS_PAGE_TARGET).toBe(120);
	});

	it('reports the cursor of the oldest loaded page', () => {
		const client = new QueryClient();
		client.setQueryData(getMessagesQueryKey('session-1'), splitTurnData());
		// The oldest loaded page has hasMore=false, so nothing is left to fetch.
		expect(getOlderMessagesCursor(client, 'session-1')).toBeNull();
	});

	it('returns the next cursor while older pages remain', () => {
		const client = new QueryClient();
		client.setQueryData(getMessagesQueryKey('session-1'), {
			pages: [
				page([message('b', 2)], { hasMore: true, nextCursor: 'cursor-older' }),
			],
			pageParams: [null],
		} satisfies MessagesInfiniteData);

		expect(getOlderMessagesCursor(client, 'session-1')).toBe('cursor-older');
	});

	it('returns null for an unknown session', () => {
		expect(getOlderMessagesCursor(new QueryClient(), undefined)).toBeNull();
		expect(getOlderMessagesCursor(new QueryClient(), 'nope')).toBeNull();
	});
});

describe('newest page refetch reconciliation', () => {
	it('keeps already-loaded parts the capped refetch window no longer covers', () => {
		const cached = page([
			message('assistant-1', 10, {
				role: 'assistant',
				parts: [part('p1', 1), part('p2', 2), part('p3', 3)],
			}),
		]);
		const fresh = page([
			message('assistant-1', 10, {
				role: 'assistant',
				status: 'complete',
				parts: [part('p3', 3), part('p4', 4)],
			}),
		]);

		const reconciled = reconcileRefetchedPage(cached, fresh);
		expect(reconciled.items[0].parts?.map((p) => p.id)).toEqual([
			'p1',
			'p2',
			'p3',
			'p4',
		]);
		expect(reconciled.partCount).toBe(4);
	});

	it('retains cached messages the refetch window scrolled past', () => {
		const cached = page([
			message('a', 1, { parts: [part('a1', 0, { messageId: 'a' })] }),
			message('b', 2, { parts: [part('b1', 0, { messageId: 'b' })] }),
		]);
		const fresh = page([
			message('b', 2, { parts: [part('b1', 0, { messageId: 'b' })] }),
		]);

		const reconciled = reconcileRefetchedPage(cached, fresh);
		expect(reconciled.items.map((m) => m.id)).toEqual(['a', 'b']);
	});

	it('does not re-inject optimistic entries ahead of server messages', () => {
		const cached = page([
			message('optimistic-user-1', 5, {
				optimistic: 'sending',
				parts: [part('o1', 0, { messageId: 'optimistic-user-1' })],
			}),
		]);
		const fresh = page([
			message('b', 2, { parts: [part('b1', 0, { messageId: 'b' })] }),
		]);

		expect(
			reconcileRefetchedPage(cached, fresh).items.map((m) => m.id),
		).toEqual(['b']);
	});

	it('returns the fresh page untouched when nothing was lost', () => {
		const cached = page([
			message('a', 1, { parts: [part('a1', 0, { messageId: 'a' })] }),
		]);
		const fresh = page([
			message('a', 1, { parts: [part('a1', 0, { messageId: 'a' })] }),
		]);
		expect(reconcileRefetchedPage(cached, fresh)).toBe(fresh);
	});
});
