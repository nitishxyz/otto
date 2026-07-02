import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
	Goal,
	GoalStatus,
	GoalTaskStatus,
	SubagentStatus,
} from '../lib/api-client';
import { getMessagesQueryKey } from './useMessages';
import { getSessionsQueryKey } from './useSessions';
import { projectScopedKey } from '../lib/api-client/utils';

export const goalQueryKey = (sessionId: string | undefined) =>
	projectScopedKey(['goal', sessionId] as const);
export const projectGoalsQueryKey = () =>
	projectScopedKey(['goals', 'project'] as const);
export const subagentsQueryKey = (sessionId: string | undefined) =>
	projectScopedKey(['subagents', sessionId] as const);

/**
 * Lists every goal for the current project (active, completed, abandoned),
 * each with its full task queue. Powers the Looper tab overview and goal view.
 */
export function useProjectGoals() {
	return useQuery({
		queryKey: projectGoalsQueryKey(),
		queryFn: () => apiClient.listGoals(),
		refetchInterval: 10000,
	});
}

function applyGoalToProjectCache(
	queryClient: ReturnType<typeof useQueryClient>,
	goal: Goal,
) {
	queryClient.setQueryData<{ goals: Goal[] }>(projectGoalsQueryKey(), (old) =>
		old ? { goals: old.goals.map((g) => (g.id === goal.id ? goal : g)) } : old,
	);
	queryClient.invalidateQueries({ queryKey: projectGoalsQueryKey() });
}

/**
 * Appends tasks to a goal from the Looper tab. Updates the project goals
 * cache with the returned goal so the queue refreshes immediately.
 */
export function useAddProjectGoalTasks() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { goalId: string; tasks: string[] }) =>
			apiClient.addGoalTasks(input.goalId, input.tasks),
		onSuccess: ({ goal }) => applyGoalToProjectCache(queryClient, goal),
	});
}

/**
 * Deletes a goal task from the Looper tab. The server rejects in_progress
 * tasks with a 409 — surface the error to the caller via onError.
 */
export function useDeleteProjectGoalTask() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { goalId: string; taskId: string }) =>
			apiClient.deleteGoalTask(input.goalId, input.taskId),
		onSuccess: ({ goal }) => applyGoalToProjectCache(queryClient, goal),
	});
}

export function useSessionGoal(sessionId: string | undefined) {
	return useQuery({
		queryKey: goalQueryKey(sessionId),
		queryFn: () => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.getSessionGoal(sessionId);
		},
		enabled: Boolean(sessionId),
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
			queryClient.invalidateQueries({ queryKey: projectGoalsQueryKey() });
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
			queryClient.invalidateQueries({ queryKey: projectGoalsQueryKey() });
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
			queryClient.invalidateQueries({ queryKey: projectGoalsQueryKey() });
		},
	});
}

export function useSessionSubagents(
	sessionId: string | undefined,
	status?: SubagentStatus,
) {
	return useQuery({
		queryKey: projectScopedKey([
			'subagents',
			sessionId,
			status ?? 'all',
		] as const),
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
			queryClient.invalidateQueries({ queryKey: projectGoalsQueryKey() });
			queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() });
			if (sessionId) {
				queryClient.invalidateQueries({
					queryKey: getMessagesQueryKey(sessionId),
				});
			}
		},
	});
}
