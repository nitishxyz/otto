import { invoke } from '@tauri-apps/api/core';

export interface Project {
	path: string;
	name: string;
	lastOpened: string;
	pinned: boolean;
	kind?: 'local' | 'remote' | 'general';
	remoteUrl?: string;
	projectId?: string;
	machineOwnerSession?: string;
	machineOwnerSessionExpiresAt?: number;
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
	updateAvailable: boolean;
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

export interface TunnelDevice {
	deviceId: string;
	hostname?: string | null;
	name?: string | null;
	lastSeenAt?: string | null;
	status?: string | null;
}

export interface MachineBootstrap {
	deviceId: string;
	hostname?: string | null;
	name?: string | null;
}

export interface MachineProject {
	id: string;
	name: string;
	path: string;
	open: boolean;
	lastUsedAt: number;
}

export interface MachineServerInfo {
	version: string | null;
	protocol?: {
		version: number;
		minVersion: number;
		maxVersion: number;
		capabilities: string[];
	};
}

export type MachineProjectAccess =
	| {
			status: 'ready';
			apiUrl: string;
			ownerSession: string;
			ownerSessionExpiresAt: number;
			projects: MachineProject[];
			serverInfo?: MachineServerInfo | null;
	  }
	| { status: 'offline'; message: string }
	| { status: 'unavailable'; message: string };

export interface MachineOwnerAuthorizationExchange {
	loadProjects: () => Promise<MachineProjectAccess>;
}

export const machineOwnerAuthorizationExchange: MachineOwnerAuthorizationExchange =
	{
		loadProjects: () => invoke<MachineProjectAccess>('get_machine_projects'),
	};

export const isDesktopApp = (): boolean => {
	try {
		return '__TAURI__' in window;
	} catch {
		return false;
	}
};

export const tauriBridge = {
	openProjectDialog: () => invoke<string | null>('open_project_dialog'),

	ensureDesktopDaemon: () => invoke<ServerInfo>('ensure_desktop_daemon'),
	stopDesktopDaemon: () => invoke('stop_desktop_daemon'),
	startServer: (projectPath: string, port?: number) =>
		invoke<ServerInfo>('start_server', { projectPath, port }),
	stopServer: (pid: number) => invoke('stop_server', { pid }),
	stopAllServers: () => invoke('stop_all_servers'),
	listServers: () => invoke<ServerInfo[]>('list_servers'),
	getCliSelection: () => invoke<CliSelectionInfo>('get_cli_selection'),
	updateInstalledCli: () => invoke<CliSelectionInfo>('update_installed_cli'),
	listSystemFonts: () => invoke<string[]>('list_system_fonts'),
	showNativeNotification: (notification: NativeNotificationPayload) =>
		invoke('show_native_notification', { notification }),

	createNewWindow: () => invoke('create_new_window'),
	openMachineWindow: (device: TunnelDevice) =>
		invoke('open_machine_window', { device }),
	getMachineBootstrap: () =>
		invoke<MachineBootstrap | null>('get_machine_bootstrap'),
	setMachineWindowProject: (projectId: string | null) =>
		invoke('set_machine_window_project', { projectId }),
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
