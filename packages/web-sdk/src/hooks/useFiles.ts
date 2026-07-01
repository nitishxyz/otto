import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { projectScopedKey } from '../lib/api-client/utils';

export const filesQueryKey = (query = '') =>
	projectScopedKey(['files', query] as const);

export function useFiles(options: { enabled?: boolean; query?: string } = {}) {
	return useQuery({
		queryKey: filesQueryKey(options.query ?? ''),
		queryFn: async () => {
			const result = await apiClient.searchFiles(options.query ?? '');
			return result;
		},
		enabled: options.enabled ?? true,
		placeholderData: (previousData) => previousData,
		staleTime: 10000,
		refetchOnWindowFocus: true,
		retry: 1,
	});
}
