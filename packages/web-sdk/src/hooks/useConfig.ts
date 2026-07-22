import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { projectScopedKey } from '../lib/api-client/utils';
import {
	emitDefaultsChange,
	mergeDefaultsChange,
	onDefaultsChange,
} from '../lib/defaults-events';

type ConfigData = Awaited<ReturnType<typeof apiClient.getConfig>>;
type DefaultsUpdate = Parameters<typeof apiClient.updateDefaults>[0];

const pendingDefaultsUpdates = new WeakMap<object, Map<string, number>>();
const defaultsUpdateQueues = new WeakMap<
	object,
	Map<string, Promise<unknown>>
>();

function enqueueDefaultsUpdate(
	queryClient: object,
	mutationGroup: string,
	data: DefaultsUpdate,
) {
	const groups =
		defaultsUpdateQueues.get(queryClient) ??
		new Map<string, Promise<unknown>>();
	const previousUpdate = groups.get(mutationGroup) ?? Promise.resolve();
	const currentUpdate = previousUpdate
		.catch(() => {})
		.then(() => apiClient.updateDefaults(data));
	groups.set(mutationGroup, currentUpdate);
	defaultsUpdateQueues.set(queryClient, groups);
	return currentUpdate.finally(() => {
		if (groups.get(mutationGroup) === currentUpdate) {
			groups.delete(mutationGroup);
		}
		if (groups.size === 0) defaultsUpdateQueues.delete(queryClient);
	});
}

function updatePendingCount(
	queryClient: object,
	mutationGroup: string,
	delta: 1 | -1,
): number {
	const groups =
		pendingDefaultsUpdates.get(queryClient) ?? new Map<string, number>();
	const nextCount = Math.max(0, (groups.get(mutationGroup) ?? 0) + delta);
	if (nextCount === 0) {
		groups.delete(mutationGroup);
	} else {
		groups.set(mutationGroup, nextCount);
	}
	if (groups.size === 0) {
		pendingDefaultsUpdates.delete(queryClient);
	} else {
		pendingDefaultsUpdates.set(queryClient, groups);
	}
	return nextCount;
}

export const configQueryKey = () => projectScopedKey(['config'] as const);
export const providerModelsQueryKey = (provider: string | undefined) =>
	projectScopedKey(['models', provider] as const);
export const allModelsQueryKey = () =>
	projectScopedKey(['models', 'all'] as const);

export function useConfig(options?: { enabled?: boolean }) {
	const queryClient = useQueryClient();
	const queryKey = configQueryKey();
	const serializedQueryKey = JSON.stringify(queryKey);

	useEffect(() => {
		const subscribedQueryKey = JSON.parse(serializedQueryKey) as ReturnType<
			typeof configQueryKey
		>;
		return onDefaultsChange((defaults) => {
			queryClient.setQueryData<ConfigData>(subscribedQueryKey, (config) =>
				mergeDefaultsChange(config, defaults),
			);
		});
	}, [queryClient, serializedQueryKey]);

	return useQuery({
		queryKey,
		queryFn: () => apiClient.getConfig(),
		staleTime: 30000,
		enabled: options?.enabled,
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
	const queryKey = configQueryKey();
	const mutationGroup = JSON.stringify(queryKey);

	return useMutation({
		mutationKey: [...queryKey, 'update-defaults'],
		mutationFn: (data: DefaultsUpdate) =>
			enqueueDefaultsUpdate(queryClient, mutationGroup, data),
		onMutate: async (data) => {
			updatePendingCount(queryClient, mutationGroup, 1);
			await queryClient.cancelQueries({ queryKey, exact: true });

			const defaultUpdates = Object.fromEntries(
				Object.entries(data).filter(
					([key, value]) => key !== 'scope' && value !== undefined,
				),
			) as Partial<ConfigData['defaults']>;
			const previousConfig = queryClient.getQueryData<ConfigData>(queryKey);

			emitDefaultsChange(defaultUpdates);

			if (previousConfig) {
				queryClient.setQueryData<ConfigData>(queryKey, {
					...previousConfig,
					defaults: {
						...previousConfig.defaults,
						...defaultUpdates,
					},
				});
			}

			return { previousConfig, defaultUpdates };
		},
		onError: (_error, _data, context) => {
			if (!context?.previousConfig) return;
			queryClient.setQueryData<ConfigData>(queryKey, (currentConfig) => {
				if (!currentConfig) return context.previousConfig;
				const currentDefaults = currentConfig.defaults as Record<
					string,
					unknown
				>;
				const previousDefaults = context.previousConfig.defaults as Record<
					string,
					unknown
				>;
				const nextDefaults = { ...currentDefaults };
				for (const [key, value] of Object.entries(context.defaultUpdates)) {
					if (!Object.is(currentDefaults[key], value)) continue;
					if (Object.hasOwn(previousDefaults, key)) {
						nextDefaults[key] = previousDefaults[key];
					} else {
						delete nextDefaults[key];
					}
				}
				return {
					...currentConfig,
					defaults: nextDefaults as ConfigData['defaults'],
				};
			});

			const currentConfig = queryClient.getQueryData<ConfigData>(queryKey);
			if (!currentConfig) return;
			const currentDefaults = currentConfig.defaults as Record<string, unknown>;
			emitDefaultsChange(
				Object.fromEntries(
					Object.keys(context.defaultUpdates).map((key) => [
						key,
						currentDefaults[key],
					]),
				),
			);
		},
		onSettled: () => {
			if (updatePendingCount(queryClient, mutationGroup, -1) === 0) {
				return queryClient.invalidateQueries({ queryKey, exact: true });
			}
		},
	});
}
