import {
	forgetProject,
	listProjects,
	openProject,
	setProjectPinned,
} from '@ottocode/api';
import { useCallback, useEffect, useState } from 'react';
import { tauriBridge, type Project } from '../lib/tauri-bridge';

type DaemonProject = {
	id: string;
	name: string;
	path: string;
	lastUsedAt: number;
	pinned: boolean;
};

function toProject(project: DaemonProject): Project {
	return {
		path: project.path,
		name: project.name,
		lastOpened: new Date(project.lastUsedAt).toISOString(),
		pinned: project.pinned,
		kind: project.name.toLowerCase() === 'general' ? 'general' : 'local',
		projectId: project.id,
	};
}

export function useProjects() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadProjects = useCallback(async () => {
		try {
			setLoading(true);
			const response = await listProjects();
			if (response.error) throw new Error('Could not load daemon projects.');
			setProjects((response.data?.projects ?? []).map(toProject));
			setError(null);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: 'Could not load daemon projects.',
			);
			setProjects([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadProjects();
	}, [loadProjects]);

	const openProjectPath = useCallback(async (path: string) => {
		const response = await openProject({ body: { path } });
		if (response.error || !response.data)
			throw new Error('Could not open project.');
		return toProject(response.data);
	}, []);

	const openProjectDialog = useCallback(async () => {
		const path = await tauriBridge.openProjectDialog();
		return path ? openProjectPath(path) : null;
	}, [openProjectPath]);

	const removeProject = useCallback(
		async (path: string) => {
			const project = projects.find((item) => item.path === path);
			if (!project?.projectId) return;
			const response = await forgetProject({
				path: { projectId: project.projectId },
			});
			if (response.error) throw new Error('Could not forget project.');
			await loadProjects();
		},
		[loadProjects, projects],
	);

	const togglePinned = useCallback(
		async (path: string) => {
			const project = projects.find((item) => item.path === path);
			if (!project?.projectId) return;
			const response = await setProjectPinned({
				path: { projectId: project.projectId },
				body: { pinned: !project.pinned },
			});
			if (response.error) throw new Error('Could not update pinned project.');
			await loadProjects();
		},
		[loadProjects, projects],
	);

	return {
		projects,
		loading,
		error,
		openProject: openProjectPath,
		openProjectDialog,
		removeProject,
		togglePinned,
		refresh: loadProjects,
	};
}
