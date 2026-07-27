import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import { useGitStore } from '../stores/gitStore';
import { projectScopedKey } from '../lib/api-client/utils';

export const gitStatusQueryKey = () =>
	projectScopedKey(['git', 'status'] as const);
export const gitBranchQueryKey = () =>
	projectScopedKey(['git', 'branch'] as const);
export const gitRemotesQueryKey = () =>
	projectScopedKey(['git', 'remotes'] as const);
export const gitBranchesQueryKey = () =>
	projectScopedKey(['git', 'branches'] as const);
export const gitDiffQueryKey = (file: string | null, staged = false) =>
	projectScopedKey(['git', 'diff', file, staged] as const);

export function useGitStatus() {
	const isExpanded = useGitStore((state) => state.isExpanded);

	return useQuery({
		queryKey: gitStatusQueryKey(),
		queryFn: () => apiClient.getGitStatus(),
		// Only poll when sidebar is expanded to reduce unnecessary requests
		// Disabled during active generation to prevent interference
		refetchInterval: isExpanded ? 5000 : false, // Poll every 5 seconds when expanded
		retry: 1,
		// Keep data fresh but don't spam the server
		staleTime: 3000,
	});
}

export function useGitDiff(file: string | null, staged = false) {
	return useQuery({
		queryKey: gitDiffQueryKey(file, staged),
		queryFn: () => (file ? apiClient.getGitDiff(file, staged) : null),
		enabled: !!file,
		retry: 1,
		// Don't refetch automatically for diff views
		refetchInterval: false,
	});
}

export function useGitBranch() {
	const isExpanded = useGitStore((state) => state.isExpanded);

	return useQuery({
		queryKey: gitBranchQueryKey(),
		queryFn: () => apiClient.getGitBranch(),
		// Only poll when sidebar is expanded
		refetchInterval: isExpanded ? 10000 : false, // Poll every 10 seconds
		retry: 1,
		staleTime: 5000,
	});
}

export function useGenerateCommitMessage(sessionId?: string | null) {
	return useMutation({
		mutationFn: () => apiClient.generateCommitMessage(sessionId ?? undefined),
	});
}

export function useStageFiles() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (files: string[]) => apiClient.stageFiles(files),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
		},
	});
}

export function useUnstageFiles() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (files: string[]) => apiClient.unstageFiles(files),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
		},
	});
}

export function useRestoreFiles() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (files: string[]) => apiClient.restoreFiles(files),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
		},
	});
}

export function useDeleteFiles() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (files: string[]) => apiClient.deleteFiles(files),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
		},
	});
}

export function useCommitChanges() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			message,
			sessionId,
		}: {
			message: string;
			sessionId?: string | null;
		}) => apiClient.commitChanges(message, sessionId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitBranchQueryKey() });
		},
	});
}

export function usePushCommits() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (sessionId?: string | null) => apiClient.pushCommits(sessionId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitBranchQueryKey() });
		},
	});
}

export function usePullChanges() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (sessionId?: string | null) => apiClient.pullChanges(sessionId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitBranchQueryKey() });
		},
	});
}

export function useGitRebaseAction() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (action: 'continue' | 'abort' | 'skip') =>
			apiClient.performRebaseAction(action),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitBranchQueryKey() });
		},
	});
}

export function useGitInit() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: () => apiClient.initGitRepo(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitBranchQueryKey() });
		},
	});
}

export function useGitRemotes() {
	const isExpanded = useGitStore((state) => state.isExpanded);

	return useQuery({
		queryKey: gitRemotesQueryKey(),
		queryFn: () => apiClient.getRemotes(),
		enabled: isExpanded,
		retry: 1,
		staleTime: 10000,
	});
}

export function useAddRemote() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({ name, url }: { name: string; url: string }) =>
			apiClient.addRemote(name, url),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitRemotesQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
		},
	});
}

export function useRemoveRemote() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (name: string) => apiClient.removeRemote(name),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitRemotesQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
		},
	});
}

export function useGitBranches(enabled = true) {
	return useQuery({
		queryKey: gitBranchesQueryKey(),
		queryFn: () => apiClient.listGitBranches(),
		enabled,
		retry: 1,
		staleTime: 5000,
	});
}

export function useCheckoutBranch() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (branch: string) => apiClient.checkoutBranch(branch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitBranchQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitBranchesQueryKey() });
		},
	});
}

export function useCreateGitBranch() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			name,
			startPoint,
			checkout,
		}: {
			name: string;
			startPoint?: string;
			checkout?: boolean;
		}) => apiClient.createGitBranch(name, { startPoint, checkout }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitStatusQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitBranchQueryKey() });
			queryClient.invalidateQueries({ queryKey: gitBranchesQueryKey() });
		},
	});
}
