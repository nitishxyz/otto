import { invoke } from '@tauri-apps/api/core';

export interface Project {
	path: string;
	name: string;
	lastOpened: string;
	pinned?: boolean;
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

export interface NativeNotificationPayload {
	id: string;
	title: string;
	body?: string;
	sessionId?: string;
	activeSessionId?: string;
	windowFocused: boolean;
}

export interface TunnelDevice {
	deviceId: string;
	machineId: string;
	hostname?: string | null;
	name?: string | null;
	lastSeenAt?: string | null;
	status?: string | null;
}

export interface MachineBootstrap {
	deviceId: string;
	machineId: string;
	hostname?: string | null;
	name?: string | null;
}

export interface MachineProject {
	id: string;
	name: string;
	path: string;
	open: boolean;
	lastUsedAt: number;
	pinned: boolean;
}

export interface MachineServerInfo {
	version: string | null;
	pid?: number;
	startedAt?: number;
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
	getCliSelection: () => invoke<CliSelectionInfo>('get_cli_selection'),
	updateInstalledCli: () => invoke<CliSelectionInfo>('update_installed_cli'),
	listSystemFonts: () => invoke<string[]>('list_system_fonts'),
	showNativeNotification: (notification: NativeNotificationPayload) =>
		invoke('show_native_notification', { notification }),

	createNewWindow: () => invoke('create_new_window'),
	setCurrentMachine: (device: TunnelDevice | null) =>
		invoke<MachineBootstrap | null>('set_current_machine', { device }),
	getMachineBootstrap: () =>
		invoke<MachineBootstrap | null>('get_machine_bootstrap'),
	setMachineWindowProject: (projectId: string | null) =>
		invoke('set_machine_window_project', { projectId }),
	getInitialProject: () => invoke<string | null>('get_initial_project'),
	getInitialRemote: () => invoke<[string, string] | null>('get_initial_remote'),
};
