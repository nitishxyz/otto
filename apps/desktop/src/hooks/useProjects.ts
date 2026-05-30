import { useState, useEffect, useCallback } from 'react';
import { tauriBridge, type Project } from '../lib/tauri-bridge';

export function useProjects() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadProjects = useCallback(async () => {
		try {
			setLoading(true);
			const recentProjects = await tauriBridge.getRecentProjects();
			setProjects(recentProjects);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load projects');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadProjects();
	}, [loadProjects]);

	const openProject = useCallback(
		async (path: string, name: string) => {
			const project: Project = {
				path,
				name,
				lastOpened: new Date().toISOString(),
				pinned: false,
				kind: 'local',
			};
			await tauriBridge.saveRecentProject(project);
			await loadProjects();
			return project;
		},
		[loadProjects],
	);

	const openProjectDialog = useCallback(async () => {
		const path = await tauriBridge.openProjectDialog();
		if (path) {
			const name = path.split('/').pop() || path;
			return openProject(path, name);
		}
		return null;
	}, [openProject]);

	const removeProject = useCallback(
		async (path: string) => {
			await tauriBridge.removeRecentProject(path);
			await loadProjects();
		},
		[loadProjects],
	);

	const togglePinned = useCallback(
		async (path: string) => {
			await tauriBridge.toggleProjectPinned(path);
			await loadProjects();
		},
		[loadProjects],
	);

	return {
		projects,
		loading,
		error,
		openProject,
		openProjectDialog,
		removeProject,
		togglePinned,
		refresh: loadProjects,
	};
}
