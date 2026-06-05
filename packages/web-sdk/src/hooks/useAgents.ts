import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { AgentDetail, UpdateAgentInput } from '../lib/api-client/config';
import { useAgentsStore } from '../stores/agentsStore';

export type {
	AgentDetail,
	ToolDetail,
	UpdateAgentInput,
} from '../lib/api-client/config';

interface UseAgentsOptions {
	enabled?: boolean;
}

export function useAgentDetails(options: UseAgentsOptions = {}) {
	const managerOpen = useAgentsStore((s) => s.isManagerOpen);
	const createOpen = useAgentsStore((s) => s.isCreateModalOpen);
	const enabled = options.enabled ?? (managerOpen || createOpen);
	const setAgents = useAgentsStore((s) => s.setAgents);
	const selectedAgent = useAgentsStore((s) => s.selectedAgent);
	const selectAgent = useAgentsStore((s) => s.selectAgent);

	const query = useQuery({
		queryKey: ['config', 'agents'],
		queryFn: () => apiClient.getAgentDetails(),
		enabled,
		staleTime: 15_000,
	});

	useEffect(() => {
		if (!query.data) return;
		setAgents(query.data.agents, query.data.default);
		if (!selectedAgent && query.data.agents.length > 0) {
			const defaultAgent = query.data.agents.find(
				(agent) => agent.name === query.data.default,
			);
			selectAgent(defaultAgent?.name ?? query.data.agents[0].name);
		}
	}, [query.data, selectAgent, selectedAgent, setAgents]);

	return query;
}

export function useAgent(agentName: string | null) {
	return useQuery({
		queryKey: ['config', 'agents', agentName],
		queryFn: async () => {
			if (!agentName) return null;
			return apiClient.getAgent(agentName);
		},
		enabled: Boolean(agentName),
		staleTime: 15_000,
	});
}

export function useConfigTools(options: UseAgentsOptions = {}) {
	const managerOpen = useAgentsStore((s) => s.isManagerOpen);
	const createOpen = useAgentsStore((s) => s.isCreateModalOpen);
	const enabled = options.enabled ?? (managerOpen || createOpen);
	return useQuery({
		queryKey: ['config', 'tools'],
		queryFn: () => apiClient.getConfigTools(),
		enabled,
		staleTime: 30_000,
	});
}

export function useUpdateAgent() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ name, input }: { name: string; input: UpdateAgentInput }) =>
			apiClient.updateAgent(name, input),
		onSuccess: (data, variables) => {
			queryClient.setQueryData(['config', 'agents', variables.name], data);
			void queryClient.invalidateQueries({ queryKey: ['config', 'agents'] });
		},
	});
}

export function useDeleteAgent() {
	const queryClient = useQueryClient();
	const setAgents = useAgentsStore((s) => s.setAgents);
	const selectAgent = useAgentsStore((s) => s.selectAgent);
	return useMutation({
		mutationFn: ({
			name,
			scope = 'local',
		}: {
			name: string;
			scope?: 'local' | 'global';
		}) => apiClient.deleteAgent(name, scope),
		onSuccess: async (_data, variables) => {
			await queryClient.invalidateQueries({ queryKey: ['config', 'agents'] });
			const refreshed = await queryClient.fetchQuery({
				queryKey: ['config', 'agents'],
				queryFn: () => apiClient.getAgentDetails(),
			});
			setAgents(refreshed.agents, refreshed.default);
			if (variables.name === useAgentsStore.getState().selectedAgent) {
				const next =
					refreshed.agents.find((a) => a.name === refreshed.default)?.name ??
					refreshed.agents[0]?.name ??
					null;
				selectAgent(next);
			}
		},
	});
}

export function useSetDefaultAgent() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (name: string) =>
			apiClient.updateDefaults({ agent: name, scope: 'global' }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['config', 'agents'] });
			void queryClient.invalidateQueries({ queryKey: ['config'] });
		},
	});
}

export function getAgentToolCount(
	agent: AgentDetail | null | undefined,
): number {
	if (!agent) return 0;
	return Array.from(
		new Set([
			...(agent.toolConfig.firstClass ?? []),
			...(agent.toolConfig.loadable ?? []),
		]),
	).length;
}
