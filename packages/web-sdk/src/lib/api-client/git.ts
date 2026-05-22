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
} from '../../types/api';
import { extractErrorMessage } from './utils';

export const gitMixin = {
	async initGitRepo(): Promise<{ initialized: boolean; path: string }> {
		const response = await apiInitGitRepo({
			body: {},
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data;
	},

	async getGitStatus(): Promise<GitStatusResponse> {
		const response = await apiGetGitStatus();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitStatusResponse;
	},

	async getGitDiff(
		file: string,
		staged: boolean = false,
	): Promise<GitDiffResponse> {
		const response = await apiGetGitDiff({
			query: { file, staged: staged ? 'true' : 'false' },
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
			body: sessionId ? { sessionId } : {},
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitGenerateCommitMessageResponse;
	},

	async stageFiles(files: string[]): Promise<GitStageResponse> {
		const response = await apiStageFiles({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { files } as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitStageResponse;
	},

	async unstageFiles(files: string[]): Promise<GitUnstageResponse> {
		const response = await apiUnstageFiles({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { files } as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitUnstageResponse;
	},

	async restoreFiles(files: string[]): Promise<{ restored: string[] }> {
		const response = await apiRestoreFiles({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { files } as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as { restored: string[] };
	},

	async deleteFiles(files: string[]): Promise<{ deleted: string[] }> {
		const response = await apiDeleteFiles({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { files } as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as { deleted: string[] };
	},

	async commitChanges(message: string): Promise<GitCommitResponse> {
		const response = await apiCommitChanges({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { message } as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitCommitResponse;
	},

	async getGitBranch(): Promise<GitBranchInfo> {
		const response = await apiGetGitBranch();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitBranchInfo;
	},

	async pushCommits(): Promise<GitPushResponse> {
		const response = await apiPushCommits({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: {} as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitPushResponse;
	},

	async pullChanges(): Promise<GitPullResponse> {
		const response = await apiPullChanges({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: {} as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitPullResponse;
	},

	async performRebaseAction(
		action: 'continue' | 'abort' | 'skip',
	): Promise<GitRebaseActionResponse> {
		const response = await apiPerformGitRebaseAction({
			body: { action },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as GitRebaseActionResponse;
	},

	async getRemotes(): Promise<GitRemoteInfo[]> {
		const response = await apiGetGitRemotes();
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data?.remotes as GitRemoteInfo[];
	},

	async addRemote(
		name: string,
		url: string,
	): Promise<{ name: string; url: string }> {
		const response = await apiAddGitRemote({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { name, url } as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as { name: string; url: string };
	},

	async removeRemote(name: string): Promise<{ removed: string }> {
		const response = await apiRemoveGitRemote({
			// biome-ignore lint/suspicious/noExplicitAny: API type mismatch
			body: { name } as any,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return (response.data as any)?.data as { removed: string };
	},
};
