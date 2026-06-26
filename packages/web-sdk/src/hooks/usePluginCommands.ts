import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

interface UsePluginCommandsOptions {
	enabled?: boolean;
}

export function usePluginCommands(options: UsePluginCommandsOptions = {}) {
	const enabled = options.enabled ?? true;
	return useQuery({
		queryKey: ['plugin-commands'],
		queryFn: async () => apiClient.listPluginCommands(),
		enabled,
		refetchInterval: enabled ? 30000 : false,
	});
}
