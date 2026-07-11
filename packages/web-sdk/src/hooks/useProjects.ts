import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjects } from '../lib/api-client/projects';
import { projectScopedKey } from '../lib/api-client/utils';
import {
	getSharePinnedProjectId,
	isShareMode,
	setSharePinnedProjectId,
} from '../lib/share-mode';

export function projectsQueryKey() {
	return projectScopedKey(['projects'] as const);
}

export function useProjects() {
	const query = useQuery({
		queryKey: projectsQueryKey(),
		queryFn: listProjects,
		staleTime: 10_000,
	});

	// In share mode the server pins the session to a single project; capture its
	// id so client-side project context stays pinned to that project.
	useEffect(() => {
		if (!isShareMode() || getSharePinnedProjectId()) return;
		const projects = query.data;
		if (projects && projects.length === 1) {
			setSharePinnedProjectId(projects[0].id);
		}
	}, [query.data]);

	return query;
}
