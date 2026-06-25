import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
	PluginInstallInput,
	PluginMutationInput,
	PluginProjectOptions,
	PluginUpdateInput,
} from '../lib/api-client';

const PLUGINS_QUERY_KEY = ['plugins'] as const;
const PLUGIN_REGISTRY_QUERY_KEY = ['plugins', 'registry'] as const;

interface UsePluginsOptions extends PluginProjectOptions {
	enabled?: boolean;
}

function invalidatePluginQueries(
	queryClient: ReturnType<typeof useQueryClient>,
) {
	void queryClient.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY });
	void queryClient.invalidateQueries({ queryKey: PLUGIN_REGISTRY_QUERY_KEY });
}

export function usePlugins(options: UsePluginsOptions = {}) {
	const enabled = options.enabled ?? true;
	const project = options.project;
	return useQuery({
		queryKey: project ? [...PLUGINS_QUERY_KEY, project] : PLUGINS_QUERY_KEY,
		queryFn: async () => apiClient.listPlugins({ project }),
		enabled,
		refetchInterval: enabled ? 30000 : false,
	});
}

export function usePluginRegistry(options: UsePluginsOptions = {}) {
	const enabled = options.enabled ?? true;
	const project = options.project;
	return useQuery({
		queryKey: project
			? [...PLUGIN_REGISTRY_QUERY_KEY, project]
			: PLUGIN_REGISTRY_QUERY_KEY,
		queryFn: async () => apiClient.listPluginRegistry({ project }),
		enabled,
		refetchInterval: enabled ? 60000 : false,
	});
}

export function useInstallPlugin() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: PluginInstallInput) => apiClient.installPlugin(input),
		onSuccess: () => invalidatePluginQueries(queryClient),
	});
}

export function useRemovePlugin() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: PluginMutationInput) => apiClient.removePlugin(input),
		onSuccess: () => invalidatePluginQueries(queryClient),
	});
}

export function useEnablePlugin() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: PluginMutationInput) => apiClient.enablePlugin(input),
		onSuccess: () => invalidatePluginQueries(queryClient),
	});
}

export function useDisablePlugin() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: PluginMutationInput) => apiClient.disablePlugin(input),
		onSuccess: () => invalidatePluginQueries(queryClient),
	});
}

export function useUpdatePlugin() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: PluginUpdateInput) => apiClient.updatePlugin(input),
		onSuccess: () => invalidatePluginQueries(queryClient),
	});
}
