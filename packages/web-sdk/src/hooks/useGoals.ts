import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
	GoalStatus,
	GoalTaskStatus,
	SubagentStatus,
} from '../lib/api-client';
import { useConfig } from './useConfig';

export const goalQueryKey = (sessionId: string | undefined) => [
	'goal',
	sessionId,
];
export const subagentsQueryKey = (sessionId: string | undefined) => [
	'subagents',
	sessionId,
];

export function useOttoEnabled(): boolean {
	const { data: config } = useConfig();
	return config?.defaults?.ottoEnabled ?? true;
}

export function useSessionGoal(sessionId: string | undefined) {
	const ottoEnabled = useOttoEnabled();
	return useQuery({
		queryKey: goalQueryKey(sessionId),
		queryFn: () => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.getSessionGoal(sessionId);
		},
		enabled: Boolean(sessionId) && ottoEnabled,
		refetchInterval: 15000,
	});
}

export function useCreateSessionGoal(sessionId: string | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data: { title: string; tasks?: string[] }) => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.createSessionGoal(sessionId, data);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: goalQueryKey(sessionId) });
		},
	});
}

export function useUpdateGoal(sessionId: string | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			goalId: string;
			title?: string;
			status?: GoalStatus;
		}) =>
			apiClient.updateGoal(input.goalId, {
				title: input.title,
				status: input.status,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: goalQueryKey(sessionId) });
		},
	});
}

export function useAddGoalTasks(sessionId: string | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { goalId: string; tasks: string[] }) =>
			apiClient.addGoalTasks(input.goalId, input.tasks),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: goalQueryKey(sessionId) });
		},
	});
}

export function useUpdateGoalTask(sessionId: string | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			goalId: string;
			taskId: string;
			content?: string;
			status?: GoalTaskStatus;
			note?: string | null;
		}) =>
			apiClient.updateGoalTask(input.goalId, input.taskId, {
				content: input.content,
				status: input.status,
				note: input.note,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: goalQueryKey(sessionId) });
		},
	});
}

export function useSessionSubagents(
	sessionId: string | undefined,
	status?: SubagentStatus,
) {
	return useQuery({
		queryKey: [...subagentsQueryKey(sessionId), status ?? 'all'],
		queryFn: () => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.listSessionSubagents(sessionId, status);
		},
		enabled: Boolean(sessionId),
		refetchInterval: (query) => {
			const hasRunning = query.state.data?.subagents.some(
				(record) => record.status === 'running',
			);
			return hasRunning ? 5000 : 30000;
		},
	});
}

/**
 * Starts the session's goal via the server start endpoint, which injects an
 * automated tagged kickoff into the main session and marks the goal started.
 */
export function useStartGoal(sessionId: string | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { goalId: string }) =>
			apiClient.startGoal(input.goalId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: goalQueryKey(sessionId) });
			if (sessionId) {
				queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
			}
		},
	});
}
