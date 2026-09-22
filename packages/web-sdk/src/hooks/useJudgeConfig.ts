import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
	JudgeConfigResponse,
	JudgeConfigUpdate,
} from '../lib/api-client/judge';
import { projectScopedKey } from '../lib/api-client/utils';

function judgeQueryKey() {
	return projectScopedKey(['config', 'judge'] as const);
}

export function useJudgeConfig(options: { enabled?: boolean } = {}) {
	return useQuery<JudgeConfigResponse>({
		queryKey: judgeQueryKey(),
		queryFn: () => apiClient.getJudgeConfig(),
		enabled: options.enabled ?? true,
		staleTime: 30_000,
	});
}

export function useUpdateJudgeConfig() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (update: JudgeConfigUpdate) =>
			apiClient.updateJudgeConfig(update),
		onSuccess: (data) => {
			queryClient.setQueryData(judgeQueryKey(), data);
			void queryClient.invalidateQueries({
				queryKey: projectScopedKey(['tools'] as const),
			});
		},
	});
}
