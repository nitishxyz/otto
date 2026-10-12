import { useQuery } from '@tanstack/react-query';
import { apiClient, type SubagentStatus } from '../lib/api-client';
import { projectScopedKey } from '../lib/api-client/utils';

export const subagentsQueryKey = (sessionId: string | undefined) =>
	projectScopedKey(['subagents', sessionId] as const);

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
