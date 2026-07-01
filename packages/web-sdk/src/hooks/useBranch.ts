import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { CreateBranchRequest } from '../types/api';
import { projectScopedKey } from '../lib/api-client/utils';
import { getSessionsQueryKey } from './useSessions';

export function useCreateBranch(sessionId: string | undefined) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: CreateBranchRequest) => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.createBranch(sessionId, data);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: getSessionsQueryKey() });
			if (sessionId) {
				queryClient.invalidateQueries({
					queryKey: projectScopedKey(['branches', sessionId] as const),
				});
			}
		},
	});
}

export function useBranches(sessionId: string | undefined) {
	return useQuery({
		queryKey: projectScopedKey(['branches', sessionId] as const),
		queryFn: () => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.listBranches(sessionId);
		},
		enabled: Boolean(sessionId),
	});
}

export function useParentSession(sessionId: string | undefined) {
	return useQuery({
		queryKey: projectScopedKey(['parentSession', sessionId] as const),
		queryFn: () => {
			if (!sessionId) throw new Error('No session ID');
			return apiClient.getParentSession(sessionId);
		},
		enabled: Boolean(sessionId),
	});
}
