import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
	MemoryConfigResponse,
	MemoryConfigUpdate,
} from '../lib/api-client/memory';
import { projectScopedKey } from '../lib/api-client/utils';

export function memoryQueryKey() {
	return projectScopedKey(['config', 'memory'] as const);
}

export function useMemoryConfig(options: { enabled?: boolean } = {}) {
	return useQuery<MemoryConfigResponse>({
		queryKey: memoryQueryKey(),
		queryFn: () => apiClient.getMemoryConfig(),
		enabled: options.enabled ?? true,
		staleTime: 30_000,
	});
}

export function useUpdateMemoryConfig() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (update: MemoryConfigUpdate) =>
			apiClient.updateMemoryConfig(update),
		onSuccess: (data) => {
			queryClient.setQueryData(memoryQueryKey(), data);
			void queryClient.invalidateQueries({
				queryKey: projectScopedKey(['tools'] as const),
			});
		},
	});
}
