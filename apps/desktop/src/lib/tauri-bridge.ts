import { invoke } from '@tauri-apps/api/core';

export interface Project {
	path: string;
	name: string;
	lastOpened: string;
	pinned: boolean;
	kind?: 'local' | 'remote' | 'general';
	remoteUrl?: string;
}

export interface ServerInfo {
	pid: number;
	port: number;
	projectPath: string;
	projectId: string;
	url: string;
	token?: string | null;
	cliPath: string;
	cliVersion: string;
}

export interface CliSelectionInfo {
	path: string;
	version: string;
	source: string;
	embeddedPath: string;
	embeddedVersion: string;
	localPath?: string | null;
	localVersion?: string | null;
	reason: string;
}

export interface GitHubRepo {
	id: number;
	name: string;
	full_name: string;
	clone_url: string;
	private: boolean;
	description: string | null;
}

export interface GitHubUser {
	login: string;
	name: string | null;
	avatar_url: string;
}

export interface GitStatus {
	branch: string;
	ahead: number;
	behind: number;
	changedFiles: Array<{ path: string; status: string }>;
	hasChanges: boolean;
}

export interface DeviceCodeResponse {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	interval: number;
	expiresIn: number;
}

export interface DevicePollResult {
	status: 'complete' | 'pending' | 'error';
	accessToken: string | null;
	error: string | null;
}

export interface NativeNotificationPayload {
	title: string;
	body?: string;
	sessionId?: string;
}

export const isDesktopApp = (): boolean => {
	try {
		return '__TAURI__' in window;
	} catch {
		return false;
	}
};

export const tauriBridge = {
	openProjectDialog: () => invoke<string | null>('open_project_dialog'),
	getRecentProjects: () => invoke<Project[]>('get_recent_projects'),
	saveRecentProject: (project: Project) =>
		invoke('save_recent_project', { project }),
	removeRecentProject: (path: string) =>
		invoke('remove_recent_project', { path }),
	toggleProjectPinned: (path: string) =>
		invoke('toggle_project_pinned', { path }),
	getGeneralWorkspacePath: () => invoke<string>('get_general_workspace_path'),

	startServer: (projectPath: string, port?: number) =>
		invoke<ServerInfo>('start_server', { projectPath, port }),
	stopServer: (pid: number) => invoke('stop_server', { pid }),
	stopAllServers: () => invoke('stop_all_servers'),
	listServers: () => invoke<ServerInfo[]>('list_servers'),
	getCliSelection: () => invoke<CliSelectionInfo>('get_cli_selection'),
	listSystemFonts: () => invoke<string[]>('list_system_fonts'),
	showNativeNotification: (notification: NativeNotificationPayload) =>
		invoke('show_native_notification', { notification }),

	createNewWindow: () => invoke('create_new_window'),

	getInitialProject: () => invoke<string | null>('get_initial_project'),
	getInitialRemote: () => invoke<[string, string] | null>('get_initial_remote'),

	githubDeviceCodeRequest: () =>
		invoke<DeviceCodeResponse>('github_device_code_request'),
	githubDeviceCodePoll: (deviceCode: string) =>
		invoke<DevicePollResult>('github_device_code_poll', { deviceCode }),
	githubSaveToken: (token: string) => invoke('github_save_token', { token }),
	githubGetToken: () => invoke<string | null>('github_get_token'),
	githubLogout: () => invoke('github_logout'),
	githubGetUser: (token: string) =>
		invoke<GitHubUser>('github_get_user', { token }),
	githubListRepos: (token: string, page?: number, search?: string) =>
		invoke<GitHubRepo[]>('github_list_repos', { token, page, search }),

	gitClone: (url: string, path: string, token: string) =>
		invoke<string>('git_clone', { url, path, token }),
	gitStatus: (path: string) => invoke<GitStatus>('git_status', { path }),
	gitCommit: (path: string, message: string) =>
		invoke<string>('git_commit', { path, message }),
	gitPush: (path: string, token: string) => invoke('git_push', { path, token }),
	gitPull: (path: string, token: string) => invoke('git_pull', { path, token }),
	gitIsRepo: (path: string) => invoke<boolean>('git_is_repo', { path }),
};
