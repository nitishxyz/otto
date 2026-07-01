import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChangeEvent } from 'react';
import { useCallback } from 'react';
import { useProjects, projectsQueryKey } from '../../hooks/useProjects';
import {
	openProject,
	type ProjectSummary,
} from '../../lib/api-client/projects';
import {
	getRuntimeProjectContext,
	setRuntimeProjectContext,
} from '../../lib/config';

function displayName(project: ProjectSummary): string {
	return (
		project.name ||
		project.path.split('/').filter(Boolean).at(-1) ||
		project.path
	);
}

export function ProjectSwitcher() {
	const context = getRuntimeProjectContext();
	const currentProjectId = context?.projectId;
	const { data: projects = [] } = useProjects();
	const queryClient = useQueryClient();
	const switchProject = useMutation({
		mutationFn: async (project: ProjectSummary) =>
			project.open ? project : await openProject(project.path),
		onSuccess: (project) => {
			setRuntimeProjectContext({
				...getRuntimeProjectContext(),
				projectId: project.id,
				projectRoot: project.path,
			});
			queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
			if (typeof window !== 'undefined') window.location.reload();
		},
	});

	const handleChange = useCallback(
		(event: ChangeEvent<HTMLSelectElement>) => {
			const project = projects.find((item) => item.id === event.target.value);
			if (project && project.id !== currentProjectId) {
				switchProject.mutate(project);
			}
		},
		[currentProjectId, projects, switchProject],
	);

	if (!currentProjectId && projects.length === 0) return null;

	return (
		<label className="flex items-center gap-2 text-xs text-muted-foreground">
			<span className="hidden lg:inline">Project</span>
			<select
				value={currentProjectId ?? ''}
				onChange={handleChange}
				disabled={switchProject.isPending || projects.length === 0}
				className="h-8 max-w-[220px] rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none hover:bg-muted/50 focus:border-primary"
				title={context?.projectRoot ?? 'Current project'}
			>
				{!currentProjectId && <option value="">Select project</option>}
				{projects.map((project) => (
					<option key={project.id} value={project.id}>
						{project.open ? '● ' : ''}
						{displayName(project)}
					</option>
				))}
			</select>
		</label>
	);
}
