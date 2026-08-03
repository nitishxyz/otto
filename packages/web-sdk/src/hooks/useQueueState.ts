import { useQuery, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { projectScopedKey } from '../lib/api-client/utils';

export type QueueState = {
	currentMessageId: string | null;
	queuedMessages: Array<{ messageId: string; position: number }>;
	queueLength: number;
	isRunning: boolean;
};

export function getQueueStateQueryKey(sessionId: string | undefined) {
	return projectScopedKey(['queueState', sessionId] as const);
}

const defaultQueueState: QueueState = {
	currentMessageId: null,
	queuedMessages: [],
	queueLength: 0,
	isRunning: false,
};

export function normalizeQueueState(state: {
	currentMessageId: string | null;
	queuedMessages: Array<{ messageId: string; position: number }>;
	isRunning?: boolean;
}): QueueState {
	const isRunning = state.isRunning ?? Boolean(state.currentMessageId);
	const currentMessageId = isRunning ? state.currentMessageId : null;
	const hasActiveTurn = Boolean(currentMessageId);
	const queuedMessages = hasActiveTurn ? state.queuedMessages : [];

	return {
		currentMessageId,
		queuedMessages,
		queueLength: queuedMessages.length,
		isRunning: hasActiveTurn,
	};
}

/**
 * Adds a message id to a cached queue state under an explicit query key.
 * Used by the stream engine, which captures its query keys at start so
 * background engines keep writing to the right project scope.
 */
export function queueMessageIdInCache(
	queryClient: QueryClient,
	queryKey: readonly unknown[],
	messageId: string,
) {
	queryClient.setQueryData<QueueState>(queryKey, (current) => {
		if (!current) return current;
		if (!current.isRunning || !current.currentMessageId) return current;
		if (current.currentMessageId === messageId) return current;
		if (current.queuedMessages.some((item) => item.messageId === messageId)) {
			return current;
		}

		const queuedMessages = [
			...current.queuedMessages,
			{ messageId, position: current.queuedMessages.length },
		];
		return {
			...current,
			queuedMessages,
			queueLength: queuedMessages.length,
		};
	});
}

export function optimisticallyQueueMessage(
	queryClient: QueryClient,
	sessionId: string,
	messageId: string,
) {
	queueMessageIdInCache(
		queryClient,
		getQueueStateQueryKey(sessionId),
		messageId,
	);
}

/** Removes a message id from the cached queue state and re-indexes positions. */
export function removeQueuedMessageFromCache(
	queryClient: QueryClient,
	sessionId: string,
	messageId: string,
) {
	queryClient.setQueryData<QueueState>(
		getQueueStateQueryKey(sessionId),
		(current) => {
			if (!current) return current;
			if (
				!current.queuedMessages.some((item) => item.messageId === messageId)
			) {
				return current;
			}
			const queuedMessages = current.queuedMessages
				.filter((item) => item.messageId !== messageId)
				.map((item, index) => ({ ...item, position: index }));
			return {
				...current,
				queuedMessages,
				queueLength: queuedMessages.length,
			};
		},
	);
}

/**
 * Swaps an optimistic queue entry for the server-assigned message id once the
 * send request resolves. Drops the optimistic entry when the real id is
 * already present (queue.updated arrived first).
 */
export function replaceQueuedMessageIdInCache(
	queryClient: QueryClient,
	sessionId: string,
	fromMessageId: string,
	toMessageId: string,
) {
	queryClient.setQueryData<QueueState>(
		getQueueStateQueryKey(sessionId),
		(current) => {
			if (!current) return current;
			if (
				!current.queuedMessages.some((item) => item.messageId === fromMessageId)
			) {
				return current;
			}
			const hasReal = current.queuedMessages.some(
				(item) => item.messageId === toMessageId,
			);
			const queuedMessages = current.queuedMessages
				.filter((item) => (hasReal ? item.messageId !== fromMessageId : true))
				.map((item, index) => ({
					messageId:
						item.messageId === fromMessageId ? toMessageId : item.messageId,
					position: index,
				}));
			return {
				...current,
				queuedMessages,
				queueLength: queuedMessages.length,
			};
		},
	);
}

export function useQueueState(sessionId: string | undefined): QueueState {
	const { data } = useQuery<QueueState>({
		queryKey: getQueueStateQueryKey(sessionId),
		queryFn: async () => {
			if (!sessionId) return defaultQueueState;
			const queueState = await apiClient.getQueueState(sessionId);
			return normalizeQueueState(queueState);
		},
		enabled: !!sessionId,
		placeholderData: defaultQueueState,
		staleTime: Infinity,
	});

	return data ?? defaultQueueState;
}

export function useMessageQueuePosition(
	sessionId: string | undefined,
	messageId: string,
): { isQueued: boolean; isRunning: boolean; position: number | null } {
	const queueState = useQueueState(sessionId);

	if (!sessionId || !queueState) {
		return { isQueued: false, isRunning: false, position: null };
	}

	if (queueState.currentMessageId === messageId) {
		return { isQueued: false, isRunning: true, position: null };
	}

	const queuedItem = queueState.queuedMessages.find(
		(item) => item.messageId === messageId,
	);

	if (queuedItem) {
		return { isQueued: true, isRunning: false, position: queuedItem.position };
	}

	return { isQueued: false, isRunning: false, position: null };
}
