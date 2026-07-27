import {
	getGitStatus as apiGetGitStatus,
	getGitDiff as apiGetGitDiff,
	getGitBranch as apiGetGitBranch,
	stageFiles as apiStageFiles,
	unstageFiles as apiUnstageFiles,
	restoreFiles as apiRestoreFiles,
	deleteFiles as apiDeleteFiles,
	commitChanges as apiCommitChanges,
	generateCommitMessage as apiGenerateCommitMessage,
	pushCommits as apiPushCommits,
	pullChanges as apiPullChanges,
	performGitRebaseAction as apiPerformGitRebaseAction,
	initGitRepo as apiInitGitRepo,
	getGitRemotes as apiGetGitRemotes,
	addGitRemote as apiAddGitRemote,
	removeGitRemote as apiRemoveGitRemote,
	listGitBranches as apiListGitBranches,
	checkoutGitBranch as apiCheckoutGitBranch,
	createGitBranch as apiCreateGitBranch,
} from '@ottocode/api';
import type {
	GitStatusResponse,
	GitDiffResponse,
	GitStageResponse,
	GitUnstageResponse,
	GitCommitResponse,
	GitGenerateCommitMessageResponse,
	GitBranchInfo,
	GitPushResponse,
	GitPullResponse,
	GitRebaseActionResponse,
	GitRemoteInfo,
	GitBranchListResponse,
} from '../../types/api';
import { extractErrorMessage, getProjectQuery } from './utils';

export const gitMixin = {
	async initGitRepo(): Promise<{ initialized: boolean; path: string }> {
		const response = await apiInitGitRepo({
			query: getProjectQuery(),
			body: {},
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data;
	},

	async getGitStatus(): Promise<GitStatusResponse> {
		const response = await apiGetGitStatus({
			query: getProjectQuery(),
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitStatusResponse;
	},

	async getGitDiff(
		file: string,
		staged: boolean = false,
	): Promise<GitDiffResponse> {
		const response = await apiGetGitDiff({
			query: { ...getProjectQuery(), file, staged: staged ? 'true' : 'false' },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitDiffResponse;
	},

	async getGitDiffFullFile(
		file: string,
		staged = false,
	): Promise<GitDiffResponse> {
		const response = await apiGetGitDiff({
			query: {
				...getProjectQuery(),
				file,
				staged: staged ? 'true' : 'false',
				fullFile: 'true',
			},
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitDiffResponse;
	},

	async generateCommitMessage(
		sessionId?: string,
	): Promise<GitGenerateCommitMessageResponse> {
		const response = await apiGenerateCommitMessage({
			query: getProjectQuery(),
			body: sessionId ? { sessionId } : {},
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitGenerateCommitMessageResponse;
	},

	async stageFiles(files: string[]): Promise<GitStageResponse> {
		const response = await apiStageFiles({
			query: getProjectQuery(),
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { files } as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitStageResponse;
	},

	async unstageFiles(files: string[]): Promise<GitUnstageResponse> {
		const response = await apiUnstageFiles({
			query: getProjectQuery(),
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { files } as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitUnstageResponse;
	},

	async restoreFiles(files: string[]): Promise<{ restored: string[] }> {
		const response = await apiRestoreFiles({
			query: getProjectQuery(),
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { files } as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as { restored: string[] };
	},

	async deleteFiles(files: string[]): Promise<{ deleted: string[] }> {
		const response = await apiDeleteFiles({
			query: getProjectQuery(),
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { files } as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as { deleted: string[] };
	},

	async commitChanges(
		message: string,
		sessionId?: string | null,
	): Promise<GitCommitResponse> {
		const response = await apiCommitChanges({
			query: getProjectQuery(),
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { message, ...(sessionId ? { sessionId } : {}) } as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitCommitResponse;
	},

	async getGitBranch(): Promise<GitBranchInfo> {
		const response = await apiGetGitBranch({
			query: getProjectQuery(),
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitBranchInfo;
	},

	async pushCommits(sessionId?: string | null): Promise<GitPushResponse> {
		const response = await apiPushCommits({
			query: getProjectQuery(),
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: (sessionId ? { sessionId } : {}) as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitPushResponse;
	},

	async pullChanges(sessionId?: string | null): Promise<GitPullResponse> {
		const response = await apiPullChanges({
			query: getProjectQuery(),
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: (sessionId ? { sessionId } : {}) as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitPullResponse;
	},

	async performRebaseAction(
		action: 'continue' | 'abort' | 'skip',
	): Promise<GitRebaseActionResponse> {
		const response = await apiPerformGitRebaseAction({
			query: getProjectQuery(),
			body: { action },
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitRebaseActionResponse;
	},

	async getRemotes(): Promise<GitRemoteInfo[]> {
		const response = await apiGetGitRemotes({
			query: getProjectQuery(),
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data?.remotes as GitRemoteInfo[];
	},

	async addRemote(
		name: string,
		url: string,
	): Promise<{ name: string; url: string }> {
		const response = await apiAddGitRemote({
			query: getProjectQuery(),
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { name, url } as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as { name: string; url: string };
	},

	async removeRemote(name: string): Promise<{ removed: string }> {
		const response = await apiRemoveGitRemote({
			query: getProjectQuery(),
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { name } as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as { removed: string };
	},

	async listGitBranches(): Promise<GitBranchListResponse> {
		const response = await apiListGitBranches({
			query: getProjectQuery(),
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitBranchListResponse;
	},

	async checkoutBranch(branch: string): Promise<{ branch: string }> {
		const response = await apiCheckoutGitBranch({
			query: getProjectQuery(),
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { branch } as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as { branch: string };
	},

	async createGitBranch(
		name: string,
		options?: { startPoint?: string; checkout?: boolean },
	): Promise<{ branch: string; checkedOut: boolean }> {
		const response = await apiCreateGitBranch({
			query: getProjectQuery(),
			body: {
				name,
				...(options?.startPoint ? { startPoint: options.startPoint } : {}),
				...(options?.checkout !== undefined
					? { checkout: options.checkout }
					: {}),
				// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			} as any,
		} as never);
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as {
			branch: string;
			checkedOut: boolean;
		};
	},
};
