import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { useSessionFilesStore } from '../stores/sessionFilesStore';
import { projectScopedKey } from '../lib/api-client/utils';

export function useSessionFiles(sessionId: string | undefined, enabled = true) {
	const isExpanded = useSessionFilesStore((state) => state.isExpanded);

	return useQuery({
		queryKey: projectScopedKey(['session', sessionId, 'files'] as const),
		queryFn: () => (sessionId ? apiClient.getSessionFiles(sessionId) : null),
		enabled: !!sessionId && enabled,
		refetchInterval: isExpanded && enabled ? 5000 : false,
		retry: 1,
		staleTime: 3000,
	});
}
