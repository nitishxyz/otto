import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { Message, MessagePart, SendMessageRequest } from '../types/api';
import { optimisticallyQueueMessage } from './useQueueState';
import { sessionsQueryKey } from './useSessions';

interface UseMessagesOptions {
	enabled?: boolean;
	staleTime?: number;
}

function createOptimisticTextPart(args: {
	id: string;
	messageId: string;
	index: number;
	content: string;
	agent?: string;
	provider?: string;
	model?: string;
	completedAt?: number | null;
}): MessagePart {
	return {
		id: args.id,
		messageId: args.messageId,
		index: args.index,
		stepIndex: null,
		type: 'text',
		content: JSON.stringify({ text: args.content }),
		contentJson: { text: args.content },
		agent: args.agent ?? '',
		provider: args.provider ?? '',
		model: args.model ?? '',
		startedAt: Date.now(),
		completedAt: args.completedAt ?? null,
		toolName: null,
		toolCallId: null,
		toolDurationMs: null,
	};
}

function createOptimisticMessage(args: {
	id: string;
	sessionId: string;
	role: Message['role'];
	status: Message['status'];
	createdAt: number;
	content?: string;
	agent?: string;
	provider?: string;
	model?: string;
}): Message {
	return {
		id: args.id,
		sessionId: args.sessionId,
		role: args.role,
		status: args.status,
		agent: args.agent ?? '',
		provider: args.provider ?? '',
		model: args.model ?? '',
		createdAt: args.createdAt,
		completedAt: null,
		latencyMs: null,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts:
			args.content === undefined
				? []
				: [
						createOptimisticTextPart({
							id: `${args.id}-text`,
							messageId: args.id,
							index: 0,
							content: args.content,
							agent: args.agent,
							provider: args.provider,
							model: args.model,
						}),
					],
	};
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
		onMutate: async (data: SendMessageRequest) => {
			await queryClient.cancelQueries({ queryKey: ['messages', sessionId] });
			const previousMessages = queryClient.getQueryData<Message[]>([
				'messages',
				sessionId,
			]);
			const now = Date.now();
			const optimisticUserId = `optimistic-user-${now}`;
			const optimisticAssistantId = `optimistic-assistant-${now}`;
			const isCompactCommand = data.content.trim().toLowerCase() === '/compact';
			const optimisticUser = createOptimisticMessage({
				id: optimisticUserId,
				sessionId,
				role: 'user',
				status: 'complete',
				createdAt: now,
				content: data.content,
				agent: data.agent,
				provider: data.provider,
				model: data.model,
			});
			const optimisticAssistant = createOptimisticMessage({
				id: optimisticAssistantId,
				sessionId,
				role: 'assistant',
				status: 'pending',
				createdAt: now + 1,
				content: isCompactCommand ? 'Compacting context…' : undefined,
				agent: data.agent,
				provider: data.provider,
				model: data.model,
			});

			queryClient.setQueryData<Message[]>(
				['messages', sessionId],
				(current) => [...(current ?? []), optimisticUser, optimisticAssistant],
			);

			return { optimisticUserId, optimisticAssistantId, previousMessages };
		},
		mutationFn: async (data: SendMessageRequest) => {
			await apiClient.markSessionViewed(sessionId).catch(() => undefined);
			return apiClient.sendMessage(sessionId, data);
		},
		onSuccess: (result, _data, context) => {
			if (context?.optimisticAssistantId) {
				queryClient.setQueryData<Message[]>(
					['messages', sessionId],
					(current) =>
						current?.map((message) =>
							message.id === context.optimisticAssistantId
								? {
										...message,
										id: result.messageId,
										parts: message.parts?.map((part) => ({
											...part,
											messageId: result.messageId,
										})),
									}
								: message,
						),
				);
			}
			optimisticallyQueueMessage(queryClient, sessionId, result.messageId);
			queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
			queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
		},
		onError: (_error, _data, context) => {
			queryClient.setQueryData(
				['messages', sessionId],
				context?.previousMessages ?? [],
			);
		},
	});
}
