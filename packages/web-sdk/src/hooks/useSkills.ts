import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSkillsStore } from '../stores/skillsStore';
import { useEffect } from 'react';
import { apiClient } from '../lib/api-client';

interface UseSkillsOptions {
	enabled?: boolean;
}

export function useSkills(options: UseSkillsOptions = {}) {
	const enabled = options.enabled ?? true;
	const setSkillsConfig = useSkillsStore((s) => s.setSkillsConfig);

	const query = useQuery({
		queryKey: ['skills'],
		queryFn: async () => {
			return apiClient.getSkillsConfig();
		},
		enabled,
		refetchInterval: 30000,
	});

	useEffect(() => {
		if (query.data?.items) {
			setSkillsConfig({
				skills: query.data.items,
				globalEnabled: query.data.enabled,
				totalCount: query.data.totalCount,
				enabledCount: query.data.enabledCount,
			});
		}
	}, [query.data, setSkillsConfig]);

	return query;
}

export function useUpdateSkillsConfig() {
	const queryClient = useQueryClient();
	const setSkillsConfig = useSkillsStore((s) => s.setSkillsConfig);

	return useMutation({
		mutationFn: (input: {
			enabled?: boolean;
			items?: Record<string, { enabled?: boolean }>;
		}) => apiClient.updateSkillsConfig(input),
		onSuccess: (data) => {
			setSkillsConfig({
				skills: data.items,
				globalEnabled: data.enabled,
				totalCount: data.totalCount,
				enabledCount: data.enabledCount,
			});
			queryClient.setQueryData(['skills'], data);
		},
	});
}

export function useSkillDetail(name: string | null) {
	return useQuery({
		queryKey: ['skills', name],
		queryFn: async () => {
			if (!name) return null;
			return apiClient.getSkill(name);
		},
		enabled: !!name,
	});
}

export function useSkillFiles(name: string | null) {
	return useQuery({
		queryKey: ['skills', name, 'files'],
		queryFn: async () => {
			if (!name) return null;
			return apiClient.getSkillFiles(name);
		},
		enabled: !!name,
	});
}

export function useSkillFileContent(
	name: string | null,
	filePath: string | null,
) {
	return useQuery({
		queryKey: ['skills', name, 'files', filePath],
		queryFn: async () => {
			if (!name || !filePath) return null;
			return apiClient.getSkillFileContent(name, filePath);
		},
		enabled: !!name && !!filePath,
	});
}
