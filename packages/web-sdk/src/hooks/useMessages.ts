import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
	type InfiniteData,
	type QueryClient,
} from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
	Message,
	MessagePart,
	MessagesPage,
	SendMessageRequest,
} from '../types/api';
import {
	getQueueStateQueryKey,
	normalizeQueueState,
	optimisticallyQueueMessage,
	queueMessageIdInCache,
	removeQueuedMessageFromCache,
	replaceQueuedMessageIdInCache,
	type QueueState,
} from './useQueueState';
import { getSessionsQueryKey } from './useSessions';
import { projectScopedKey } from '../lib/api-client/utils';
import {
	distributeMessagesToPages,
	mergeMessagePages,
	reconcileRefetchedPage,
	sameMessageList,
} from './messagePageMerge';

interface UseMessagesOptions {
	enabled?: boolean;
	staleTime?: number;
}

/** Messages stay cached well past the default gcTime so switching back to a
 * recently viewed session renders instantly from cache. */
const MESSAGES_GC_TIME_MS = 30 * 60_000;

/**
 * Soft target of persisted message *parts* per cursor page. The route counts
 * parts but pages by whole user→assistant turns: it returns at least two
 * complete turns and keeps adding older complete turns while the total stays
 * under this target, so a page never splits a message and consecutive pages
 * never overlap.
 */
export const MESSAGE_PARTS_PAGE_TARGET = 120;

/** Server-side maximum accepted for the `limit` target. */
const MAX_MESSAGE_PARTS_PAGE_TARGET = 250;

const OPTIMISTIC_MESSAGE_PREFIX = 'optimistic-user-';

/** Safety net: optimistic entries the server never confirmed are dropped on
 * the next refetch after this window instead of lingering forever. */
const OPTIMISTIC_MESSAGE_TTL_MS = 2 * 60_000;

export function getMessagesQueryKey(sessionId: string | undefined) {
	return projectScopedKey(['messages', sessionId] as const);
}

export function isOptimisticMessageId(id: string): boolean {
	return id.startsWith(OPTIMISTIC_MESSAGE_PREFIX);
}

function getMessageText(message: Message): string | null {
	const textPart = message.parts?.find((part) => part.type === 'text');
	if (!textPart) return null;
	const data = textPart.contentJson;
	if (data && typeof data === 'object' && 'text' in data) {
		return String((data as Record<string, unknown>).text ?? '');
	}
	if (typeof textPart.content === 'string') {
		try {
			const parsed = JSON.parse(textPart.content);
			if (parsed && typeof parsed.text === 'string') return parsed.text;
		} catch {}
		return textPart.content;
	}
	return null;
}

/**
 * True when `message` is an optimistic user message whose text matches the
 * server-confirmed content. Used to drop the optimistic copy once the real
 * message arrives (via stream event or refetch).
 */
export function optimisticMessageMatchesText(
	message: Message,
	text: string,
): boolean {
	return (
		Boolean(message.optimistic) &&
		message.role === 'user' &&
		getMessageText(message) === text
	);
}

/**
 * Preserves in-flight optimistic user messages across a full refetch: entries
 * the server does not know about yet are re-appended so a background
 * invalidation cannot make a just-sent message vanish from the thread.
 */
function mergeOptimisticMessages(
	cached: Message[] | undefined,
	fresh: Message[],
): Message[] {
	const pending = cached?.filter(
		(message) =>
			message.optimistic &&
			Date.now() - message.createdAt < OPTIMISTIC_MESSAGE_TTL_MS &&
			!fresh.some((freshMessage) => {
				if (freshMessage.role !== 'user') return false;
				const text = getMessageText(freshMessage);
				return text !== null && optimisticMessageMatchesText(message, text);
			}),
	);
	if (!pending?.length) return fresh;
	return [...fresh, ...pending];
}

export type MessagesInfiniteData = InfiniteData<MessagesPage, string | null>;

function countMessageParts(items: Message[]): number {
	return items.reduce(
		(total, message) => total + (message.parts?.length ?? 0),
		0,
	);
}

/**
 * Migrates the legacy flat-array cache shape used before message pagination.
 * This is intentionally kept at the cache boundary because a newly-created
 * session may still be warmed by older application code during an upgrade.
 */
export function normalizeMessagesInfiniteData(
	data: MessagesInfiniteData | Message[] | undefined,
): MessagesInfiniteData | undefined {
	if (!data) return undefined;
	if (!Array.isArray(data)) return data;
	return {
		pages: [
			{
				items: data,
				partCount: countMessageParts(data),
				hasMore: false,
				nextCursor: null,
			},
		],
		pageParams: [null],
	};
}

/** Memoized per pages array so repeated merges keep object identity stable. */
const flattenedPagesCache = new WeakMap<
	readonly MessagesPage[],
	readonly Message[]
>();

/**
 * Flattens cursor pages into one chronological thread. Pages are stored
 * newest-first and hold whole turns, so this is a concatenation that keeps
 * every already-loaded message object identical; ids that still manage to
 * repeat (a widened refetch of the newest page) are collapsed defensively into
 * one message with the newest metadata and the union of every loaded part.
 */
export function flattenMessagePages(
	data: MessagesInfiniteData | Message[] | undefined,
): Message[] {
	const normalized = normalizeMessagesInfiniteData(data);
	if (!normalized?.pages.length) return [];
	const cached = flattenedPagesCache.get(normalized.pages);
	if (cached) return cached as Message[];
	const merged = mergeMessagePages(normalized.pages);
	flattenedPagesCache.set(normalized.pages, merged);
	return merged;
}

/**
 * Cursor the next (older) page would be fetched with. Used to dedupe repeated
 * prepend requests for the same page while the user sits at the top.
 */
export function getOlderMessagesCursor(
	queryClient: QueryClient,
	sessionId: string | undefined,
): string | null {
	if (!sessionId) return null;
	const data = normalizeMessagesInfiniteData(
		queryClient.getQueryData<MessagesInfiniteData | Message[]>(
			getMessagesQueryKey(sessionId),
		),
	);
	const oldest = data?.pages.at(-1);
	return oldest?.hasMore ? (oldest.nextCursor ?? null) : null;
}

/** Reads the current thread as one chronological array, or undefined when the
 * session has never been fetched. */
export function getMessagesFromCache(
	queryClient: QueryClient,
	sessionId: string,
): Message[] | undefined {
	const data = normalizeMessagesInfiniteData(
		queryClient.getQueryData<MessagesInfiniteData | Message[]>(
			getMessagesQueryKey(sessionId),
		),
	);
	if (!data?.pages.length) return undefined;
	return flattenMessagePages(data);
}

/**
 * Updates the paged messages cache through a flat-array updater so callers
 * (stream engine, optimistic sends, retry) stay page-shape agnostic. Each
 * message is written back to the page it was loaded from, and untouched pages
 * are returned by identity so an edit at the live edge cannot invalidate the
 * older pages above it.
 */
export function updateMessagesCache(
	queryClient: QueryClient,
	sessionId: string,
	updater: (messages: Message[]) => Message[],
) {
	queryClient.setQueryData<MessagesInfiniteData | Message[]>(
		getMessagesQueryKey(sessionId),
		(data) => {
			const normalized = normalizeMessagesInfiniteData(data);
			if (!normalized?.pages.length) return normalized;
			const current = flattenMessagePages(normalized);
			const next = updater(current);
			if (next === current || sameMessageList(current, next)) return normalized;
			const pages = distributeMessagesToPages(normalized.pages, next);
			return pages ? { ...normalized, pages } : normalized;
		},
	);
}

function createMessagePageQueryOptions(
	queryClient: QueryClient,
	sessionId: string,
) {
	return {
		queryKey: getMessagesQueryKey(sessionId),
		queryFn: async ({ pageParam }: { pageParam: string | null }) => {
			if (pageParam) {
				return apiClient.getMessagePage(sessionId, {
					limit: MESSAGE_PARTS_PAGE_TARGET,
					cursor: pageParam,
				});
			}
			const cachedData = normalizeMessagesInfiniteData(
				queryClient.getQueryData<MessagesInfiniteData | Message[]>(
					getMessagesQueryKey(sessionId),
				),
			);
			// Refetching the newest page must still cover every part it already
			// holds, otherwise turns that grew since the first fetch would push
			// older ones past the page window and leave a gap above the next
			// cursor page. `partCount` is the page's authoritative part total and
			// stays a soft target: the route still returns whole turns.
			const limit = Math.min(
				MAX_MESSAGE_PARTS_PAGE_TARGET,
				Math.max(
					MESSAGE_PARTS_PAGE_TARGET,
					cachedData?.pages[0]?.partCount ?? 0,
				),
			);
			const fresh = await apiClient.getMessagePage(sessionId, { limit });
			const page = reconcileRefetchedPage(cachedData?.pages[0], fresh);
			// Only the newest page can hold optimistic sends.
			const cached = flattenMessagePages(cachedData);
			return { ...page, items: mergeOptimisticMessages(cached, page.items) };
		},
		initialPageParam: null as string | null,
		getNextPageParam: (lastPage: MessagesPage) =>
			lastPage.hasMore ? lastPage.nextCursor : null,
	};
}

/** Fetches the initial paged thread cache and waits until it is ready. */
export function fetchSessionMessages(
	queryClient: QueryClient,
	sessionId: string,
) {
	return queryClient.fetchInfiniteQuery({
		...createMessagePageQueryOptions(queryClient, sessionId),
		staleTime: 15_000,
	});
}

export function useMessages(
	sessionId: string | undefined,
	options: UseMessagesOptions = {},
) {
	const { enabled = true, staleTime = 15_000 } = options;
	const queryClient = useQueryClient();

	return useInfiniteQuery({
		...createMessagePageQueryOptions(queryClient, sessionId ?? ''),
		queryKey: getMessagesQueryKey(sessionId),
		enabled: !!sessionId && enabled,
		staleTime,
		gcTime: MESSAGES_GC_TIME_MS,
		refetchOnWindowFocus: false,
		select: flattenMessagePages,
	});
}

/** Warms the messages and queue-state caches (e.g. on session hover) so
 * switching to the session renders without a loading state. */
export function prefetchSessionMessages(
	queryClient: QueryClient,
	sessionId: string,
) {
	void queryClient.prefetchInfiniteQuery({
		...createMessagePageQueryOptions(queryClient, sessionId),
		staleTime: 15_000,
	});
	void queryClient.prefetchQuery({
		queryKey: getQueueStateQueryKey(sessionId),
		queryFn: async () =>
			normalizeQueueState(await apiClient.getQueueState(sessionId)),
		staleTime: 15_000,
	});
}

function buildOptimisticParts(
	messageId: string,
	data: SendMessageRequest,
	base: Pick<Message, 'agent' | 'provider' | 'model'>,
): MessagePart[] {
	const now = Date.now();
	const partBase = {
		messageId,
		stepIndex: null,
		agent: base.agent,
		provider: base.provider,
		model: base.model,
		startedAt: now,
		completedAt: now,
		toolName: null,
		toolCallId: null,
		toolDurationMs: null,
	};
	const parts: MessagePart[] = [
		{
			...partBase,
			id: `${messageId}-text`,
			index: 0,
			type: 'text',
			content: JSON.stringify({ text: data.content }),
			contentJson: { text: data.content },
		},
	];
	for (const [fileIndex, file] of (data.files ?? []).entries()) {
		const contentJson: Record<string, unknown> = {
			type: file.type,
			name: file.name,
			mediaType: file.mediaType,
			...(file.data ? { data: file.data } : {}),
			...(file.attachmentId ? { attachmentId: file.attachmentId } : {}),
		};
		parts.push({
			...partBase,
			id: `${messageId}-file-${fileIndex}`,
			index: fileIndex + 1,
			type: file.type === 'image' ? 'image' : 'file',
			content: JSON.stringify(contentJson),
			contentJson,
		});
	}
	return parts;
}

export interface OptimisticSendContext {
	optimisticId: string | null;
	queued: boolean;
}

function insertOptimisticUserMessage(
	queryClient: QueryClient,
	sessionId: string,
	data: SendMessageRequest,
): OptimisticSendContext {
	if (!getMessagesFromCache(queryClient, sessionId)) {
		return { optimisticId: null, queued: false };
	}

	const queueState = queryClient.getQueryData<QueueState>(
		getQueueStateQueryKey(sessionId),
	);
	const queued = Boolean(queueState?.isRunning && queueState.currentMessageId);
	const optimisticId = `${OPTIMISTIC_MESSAGE_PREFIX}${Date.now()}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
	const base = {
		agent: data.agent ?? '',
		provider: data.provider ?? '',
		model: data.model ?? '',
	};
	const message: Message = {
		id: optimisticId,
		sessionId,
		role: 'user',
		status: 'pending',
		...base,
		createdAt: Date.now(),
		completedAt: null,
		latencyMs: null,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts: buildOptimisticParts(optimisticId, data, base),
		optimistic: queued ? 'queued' : 'sending',
	};

	updateMessagesCache(queryClient, sessionId, (old) => [...old, message]);
	if (queued) {
		queueMessageIdInCache(
			queryClient,
			getQueueStateQueryKey(sessionId),
			optimisticId,
		);
	}
	return { optimisticId, queued };
}

function removeOptimisticUserMessage(
	queryClient: QueryClient,
	sessionId: string,
	context: OptimisticSendContext | undefined,
) {
	if (!context?.optimisticId) return;
	const { optimisticId } = context;
	updateMessagesCache(queryClient, sessionId, (old) =>
		old.filter((message) => message.id !== optimisticId),
	);
	removeQueuedMessageFromCache(queryClient, sessionId, optimisticId);
}

function settleOptimisticUserMessage(
	queryClient: QueryClient,
	sessionId: string,
	context: OptimisticSendContext,
	assistantMessageId: string,
) {
	if (!context.optimisticId) return;
	const { optimisticId } = context;
	// The send is confirmed: stop showing the sending spinner. The optimistic
	// row is dropped once the server copy arrives (stream event or refetch).
	updateMessagesCache(queryClient, sessionId, (old) =>
		old.map((message) =>
			message.id === optimisticId
				? { ...message, status: 'complete' as const }
				: message,
		),
	);
	if (context.queued) {
		replaceQueuedMessageIdInCache(
			queryClient,
			sessionId,
			optimisticId,
			assistantMessageId,
		);
	}
}

export function useSendMessage(sessionId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: SendMessageRequest) => {
			// Fire-and-forget: the viewed marker must never delay the send.
			void apiClient.markSessionViewed(sessionId).catch(() => undefined);
			return apiClient.sendMessage(sessionId, data);
		},
		onMutate: (data: SendMessageRequest): OptimisticSendContext =>
			insertOptimisticUserMessage(queryClient, sessionId, data),
		onError: (_error, _data, context) => {
			removeOptimisticUserMessage(queryClient, sessionId, context);
		},
		onSuccess: (result, _data, context) => {
			if (result.pluginCommand) {
				removeOptimisticUserMessage(queryClient, sessionId, context);
				queryClient.invalidateQueries({ queryKey: ['terminals'] });
				return;
			}
			if (!result.messageId) {
				removeOptimisticUserMessage(queryClient, sessionId, context);
				return;
			}
			settleOptimisticUserMessage(
				queryClient,
				sessionId,
				context,
				result.messageId,
			);
			optimisticallyQueueMessage(queryClient, sessionId, result.messageId);
			queryClient.invalidateQueries({
				queryKey: getMessagesQueryKey(sessionId),
			});
			queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() });
		},
	});
}
