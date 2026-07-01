import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { projectScopedKey } from '../lib/api-client/utils';

export function useFileTree(dirPath: string, enabled = true) {
	return useQuery({
		queryKey: projectScopedKey(['files', 'tree', dirPath] as const),
		queryFn: () => apiClient.getFileTree(dirPath),
		enabled,
		staleTime: 10000,
		retry: 1,
	});
}

export function useFileContent(filePath: string | null) {
	return useQuery({
		queryKey: projectScopedKey(['files', 'read', filePath] as const),
		queryFn: () => (filePath ? apiClient.readFileContent(filePath) : null),
		enabled: !!filePath,
		staleTime: 5000,
		retry: 1,
	});
}

export function useGitDiffFullFile(
	file: string | null,
	staged = false,
	enabled = false,
) {
	return useQuery({
		queryKey: projectScopedKey([
			'git',
			'diff',
			'fullFile',
			file,
			staged,
		] as const),
		queryFn: () => (file ? apiClient.getGitDiffFullFile(file, staged) : null),
		enabled: enabled && !!file,
		retry: 1,
		refetchInterval: false,
	});
}
