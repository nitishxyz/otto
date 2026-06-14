import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

type ConfigData = Awaited<ReturnType<typeof apiClient.getConfig>>;

export function useConfig() {
	return useQuery({
		queryKey: ['config'],
		queryFn: () => apiClient.getConfig(),
		staleTime: 30000,
	});
}

export function useModels(provider?: string) {
	return useQuery({
		queryKey: ['models', provider],
		queryFn: () => (provider ? apiClient.getModels(provider) : null),
		enabled: !!provider,
	});
}

export function useAllModels() {
	return useQuery({
		queryKey: ['models', 'all'],
		queryFn: () => apiClient.getAllModels(),
	});
}

export function useUpdateDefaults() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: {
			agent?: string;
			provider?: string;
			model?: string;
			toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
			guidedMode?: boolean;
			reasoningText?: boolean;
			reasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
			theme?: 'light' | 'dark';
			vimMode?: boolean;
			compactThread?: boolean;
			fontFamily?: string;
			smartEdges?: boolean;
			releaseToSend?: boolean;
			fullWidthContent?: boolean;
			autoCompactThresholdTokens?: number | null;
			coAuthorCommits?: boolean;
			ottoEnabled?: boolean;
			scope?: 'global';
		}) => apiClient.updateDefaults(data),
		onMutate: async (data) => {
			await queryClient.cancelQueries({ queryKey: ['config'] });

			const previousConfig = queryClient.getQueryData<ConfigData>(['config']);
			if (previousConfig) {
				const defaultUpdates = Object.fromEntries(
					Object.entries(data).filter(
						([key, value]) => key !== 'scope' && value !== undefined,
					),
				) as Partial<ConfigData['defaults']>;

				queryClient.setQueryData<ConfigData>(['config'], {
					...previousConfig,
					defaults: {
						...previousConfig.defaults,
						...defaultUpdates,
					},
				});
			}

			return { previousConfig };
		},
		onError: (_error, _data, context) => {
			if (context?.previousConfig) {
				queryClient.setQueryData(['config'], context.previousConfig);
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['config'] });
		},
	});
}
