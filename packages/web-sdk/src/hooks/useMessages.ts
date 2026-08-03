import {
	useMutation,
	useQuery,
	useQueryClient,
	type QueryClient,
} from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { Message, MessagePart, SendMessageRequest } from '../types/api';
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

interface UseMessagesOptions {
	enabled?: boolean;
	staleTime?: number;
}

/** Messages stay cached well past the default gcTime so switching back to a
 * recently viewed session renders instantly from cache. */
const MESSAGES_GC_TIME_MS = 30 * 60_000;

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

export function useMessages(
	sessionId: string | undefined,
	options: UseMessagesOptions = {},
) {
	const { enabled = true, staleTime = 15_000 } = options;
	const queryClient = useQueryClient();

	return useQuery({
		queryKey: getMessagesQueryKey(sessionId),
		queryFn: async () => {
			if (!sessionId) {
				throw new Error('Session ID is required');
			}
			const fresh = await apiClient.getMessages(sessionId);
			const cached = queryClient.getQueryData<Message[]>(
				getMessagesQueryKey(sessionId),
			);
			return mergeOptimisticMessages(cached, fresh);
		},
		enabled: !!sessionId && enabled,
		staleTime,
		gcTime: MESSAGES_GC_TIME_MS,
		refetchOnWindowFocus: false,
	});
}

/** Warms the messages and queue-state caches (e.g. on session hover) so
 * switching to the session renders without a loading state. */
export function prefetchSessionMessages(
	queryClient: QueryClient,
	sessionId: string,
) {
	void queryClient.prefetchQuery({
		queryKey: getMessagesQueryKey(sessionId),
		queryFn: () => apiClient.getMessages(sessionId),
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
	const messagesQueryKey = getMessagesQueryKey(sessionId);
	if (!queryClient.getQueryData<Message[]>(messagesQueryKey)) {
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

	queryClient.setQueryData<Message[]>(messagesQueryKey, (old) =>
		old ? [...old, message] : old,
	);
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
	queryClient.setQueryData<Message[]>(getMessagesQueryKey(sessionId), (old) =>
		old ? old.filter((message) => message.id !== optimisticId) : old,
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
	queryClient.setQueryData<Message[]>(getMessagesQueryKey(sessionId), (old) =>
		old
			? old.map((message) =>
					message.id === optimisticId
						? { ...message, status: 'complete' as const }
						: message,
				)
			: old,
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
		mutationFn: async (data: SendMessageRequest) => {
			await apiClient.markSessionViewed(sessionId).catch(() => undefined);
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
