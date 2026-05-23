import { useQuery, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

export type QueueState = {
	currentMessageId: string | null;
	queuedMessages: Array<{ messageId: string; position: number }>;
	queueLength: number;
};

const defaultQueueState: QueueState = {
	currentMessageId: null,
	queuedMessages: [],
	queueLength: 0,
};

export function optimisticallyQueueMessage(
	queryClient: QueryClient,
	sessionId: string,
	messageId: string,
) {
	queryClient.setQueryData<QueueState>(['queueState', sessionId], (current) => {
		if (!current) return current;
		const isBusy =
			Boolean(current.currentMessageId) ||
			current.queuedMessages.length > 0 ||
			current.queueLength > 0;
		if (!isBusy) return current;
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
			return {
				currentMessageId: queueState.currentMessageId,
				queuedMessages: queueState.queuedMessages,
				queueLength: queueState.queuedMessages.length,
			};
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
