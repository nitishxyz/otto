import { useQuery } from '@tanstack/react-query';
import { listProjects } from '../lib/api-client/projects';
import { projectScopedKey } from '../lib/api-client/utils';

export function projectsQueryKey() {
	return projectScopedKey(['projects'] as const);
}

export function useProjects() {
	return useQuery({
		queryKey: projectsQueryKey(),
		queryFn: listProjects,
		staleTime: 10_000,
	});
}
