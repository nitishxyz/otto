import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ThemeId } from '@ottocode/themes';
import { apiClient } from '../lib/api-client';
import { projectScopedKey } from '../lib/api-client/utils';

type ConfigData = Awaited<ReturnType<typeof apiClient.getConfig>>;

export const configQueryKey = () => projectScopedKey(['config'] as const);
export const providerModelsQueryKey = (provider: string | undefined) =>
	projectScopedKey(['models', provider] as const);
export const allModelsQueryKey = () =>
	projectScopedKey(['models', 'all'] as const);

export function useConfig() {
	return useQuery({
		queryKey: configQueryKey(),
		queryFn: () => apiClient.getConfig(),
		staleTime: 30000,
	});
}

export function useModels(provider?: string) {
	return useQuery({
		queryKey: providerModelsQueryKey(provider),
		queryFn: () => (provider ? apiClient.getModels(provider) : null),
		enabled: !!provider,
	});
}

export function useAllModels() {
	return useQuery({
		queryKey: allModelsQueryKey(),
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
			theme?: ThemeId;
			tuiTheme?: string;
			vimMode?: boolean;
			compactThread?: boolean;
			fontFamily?: string;
			smartEdges?: boolean;
			threadNavigatorRail?: boolean;
			releaseToSend?: boolean;
			fullWidthContent?: boolean;
			notificationsEnabled?: boolean;
			autoCompactThresholdTokens?: number | null;
			coAuthorCommits?: boolean;
			ottoEnabled?: boolean;
			scope?: 'global' | 'local';
		}) => apiClient.updateDefaults(data),
		onMutate: async (data) => {
			const queryKey = configQueryKey();
			await queryClient.cancelQueries({ queryKey });

			const previousConfig = queryClient.getQueryData<ConfigData>(queryKey);
			if (previousConfig) {
				const defaultUpdates = Object.fromEntries(
					Object.entries(data).filter(
						([key, value]) => key !== 'scope' && value !== undefined,
					),
				) as Partial<ConfigData['defaults']>;

				queryClient.setQueryData<ConfigData>(queryKey, {
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
				queryClient.setQueryData(configQueryKey(), context.previousConfig);
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: configQueryKey() });
		},
	});
}
