import { useQuery, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

export type QueueState = {
	currentMessageId: string | null;
	queuedMessages: Array<{ messageId: string; position: number }>;
	queueLength: number;
	isRunning: boolean;
};

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

export function optimisticallyQueueMessage(
	queryClient: QueryClient,
	sessionId: string,
	messageId: string,
) {
	queryClient.setQueryData<QueueState>(['queueState', sessionId], (current) => {
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

export function useQueueState(sessionId: string | undefined): QueueState {
	const { data } = useQuery<QueueState>({
		queryKey: ['queueState', sessionId],
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
