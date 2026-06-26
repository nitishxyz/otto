import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { SendMessageRequest } from '../types/api';
import { optimisticallyQueueMessage } from './useQueueState';
import { sessionsQueryKey } from './useSessions';

interface UseMessagesOptions {
	enabled?: boolean;
	staleTime?: number;
}

export function useMessages(
	sessionId: string | undefined,
	options: UseMessagesOptions = {},
) {
	const { enabled = true, staleTime = 15_000 } = options;

	return useQuery({
		queryKey: ['messages', sessionId],
		queryFn: () => {
			if (!sessionId) {
				throw new Error('Session ID is required');
			}
			return apiClient.getMessages(sessionId);
		},
		enabled: !!sessionId && enabled,
		staleTime,
		refetchOnWindowFocus: false,
	});
}

export function useSendMessage(sessionId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (data: SendMessageRequest) => {
			await apiClient.markSessionViewed(sessionId).catch(() => undefined);
			return apiClient.sendMessage(sessionId, data);
		},
		onSuccess: (result) => {
			if (result.pluginCommand) {
				queryClient.invalidateQueries({ queryKey: ['terminals'] });
				return;
			}
			if (!result.messageId) return;
			optimisticallyQueueMessage(queryClient, sessionId, result.messageId);
			queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
			queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
		},
	});
}
