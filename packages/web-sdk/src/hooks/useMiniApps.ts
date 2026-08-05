import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type MiniAppScope } from '../lib/api-client';

export function useMiniApps(enabled = true) {
	return useQuery({
		queryKey: ['mini-apps'],
		queryFn: () => apiClient.listMiniApps(),
		enabled,
		refetchInterval: 30_000,
	});
}

export function useBuildMiniApp() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { scope: MiniAppScope; appId: string }) =>
			apiClient.buildMiniApp(input.scope, input.appId),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mini-apps'] }),
	});
}
