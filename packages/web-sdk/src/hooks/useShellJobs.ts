import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ShellJob } from '../lib/api-client';
import { projectScopedKey } from '../lib/api-client/utils';

export const shellJobsQueryKey = (sessionId: string | undefined) =>
	projectScopedKey(['shell-jobs', sessionId] as const);

/**
 * Hydrates shell jobs for a session. Live lifecycle and output updates arrive
 * through the session event stream and update this query cache directly.
 */
export function useSessionShellJobs(sessionId: string | undefined) {
	return useQuery({
		queryKey: shellJobsQueryKey(sessionId),
		queryFn: () => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.listSessionShellJobs(sessionId);
		},
		enabled: Boolean(sessionId),
		refetchOnWindowFocus: true,
	});
}

/**
 * Selects the active (running, non-detached) shell job matching a tool
 * callId, if any. Used by the inline shell tool box to offer Detach.
 */
export function useActiveShellJobForToolCall(
	sessionId: string | undefined,
	callId: string | null | undefined,
) {
	return useQuery({
		queryKey: shellJobsQueryKey(sessionId),
		queryFn: () => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.listSessionShellJobs(sessionId);
		},
		enabled: Boolean(sessionId && callId),
		select: (data) =>
			data.jobs.find(
				(job) =>
					job.callId === callId && job.status === 'running' && !job.detached,
			),
	});
}

export function useDetachSessionShellJob(sessionId: string | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { jobId: string }) => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.detachSessionShellJob(sessionId, input.jobId);
		},
		onSuccess: ({ job }) => {
			queryClient.setQueryData<{ jobs: ShellJob[] }>(
				shellJobsQueryKey(sessionId),
				(current) => ({
					jobs: current?.jobs.some((entry) => entry.id === job.id)
						? current.jobs.map((entry) => (entry.id === job.id ? job : entry))
						: [job, ...(current?.jobs ?? [])],
				}),
			);
		},
	});
}

export function useAbortSessionShellJob(sessionId: string | undefined) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { jobId: string }) => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.abortSessionShellJob(sessionId, input.jobId);
		},
		onSuccess: ({ job }) => {
			queryClient.setQueryData<{ jobs: ShellJob[] }>(
				shellJobsQueryKey(sessionId),
				(current) => ({
					jobs: current?.jobs.some((entry) => entry.id === job.id)
						? current.jobs.map((entry) => (entry.id === job.id ? job : entry))
						: [job, ...(current?.jobs ?? [])],
				}),
			);
		},
	});
}
