import {
	forgetProject,
	listAuthorizedMachineProjects,
	listOttoRouterDevices,
	listProjectDirectories,
	openGeneralProject,
	openProject,
	pollOttoRouterDeviceFlow,
	removeProvider,
	restartServer,
	setProjectPinned,
	stageServerUpgrade,
	startOttoRouterDeviceFlow,
} from '@ottocode/api';
import type {
	MachineBootstrap,
	MachineProject,
	MachineProjectAccess,
} from './tauri-bridge';

type ReadyMachineAccess = Extract<MachineProjectAccess, { status: 'ready' }>;

export interface MachineDirectoryListing {
	path: string;
	parent: string | null;
	directories: Array<{ name: string; path: string }>;
	truncated: boolean;
}

export interface MachineDevice {
	deviceId: string;
	hostname?: string | null;
	name?: string | null;
	status?: string | null;
}

export interface MachineDeviceState {
	configured: boolean;
	devices: MachineDevice[];
	error?: string;
}

export async function loadAuthorizedMachineProjects(
	machine: MachineBootstrap,
	localDaemonUrl: string,
	forceOwnerSession = false,
): Promise<MachineProjectAccess> {
	if (!machine.hostname) {
		return {
			status: 'unavailable',
			message: 'This machine has no tunnel hostname.',
		};
	}
	const response = await listAuthorizedMachineProjects({
		baseURL: localDaemonUrl,
		body: {
			deviceId: machine.deviceId,
			hostname: machine.hostname,
			forceOwnerSession,
		} as { deviceId: string; hostname: string; forceOwnerSession?: boolean },
	});
	if (response.error) throw new Error('Machine projects unavailable.');
	return response.data as MachineProjectAccess;
}

function remoteOptions(access: ReadyMachineAccess) {
	return {
		baseURL: access.apiUrl,
		headers: { 'X-Otto-Owner-Session': access.ownerSession },
	};
}

export async function loadMachineDirectories(
	access: ReadyMachineAccess,
	path?: string,
): Promise<MachineDirectoryListing> {
	const response = await listProjectDirectories({
		...remoteOptions(access),
		query: path ? { path } : undefined,
	});
	if (response.error || !response.data) {
		throw new Error('Could not browse directories on this machine.');
	}
	return response.data;
}

export async function openMachineProject(
	access: ReadyMachineAccess,
	path: string,
): Promise<MachineProject> {
	const response = await openProject({
		...remoteOptions(access),
		body: { path },
	});
	if (response.error || !response.data) {
		throw new Error('Could not open the project on this machine.');
	}
	return response.data;
}

export async function openMachineGeneralProject(
	access: ReadyMachineAccess,
): Promise<MachineProject> {
	const response = await openGeneralProject(remoteOptions(access));
	if (response.error || !response.data) {
		throw new Error('Could not open General on this machine.');
	}
	return response.data;
}

export async function setMachineProjectPinned(
	access: ReadyMachineAccess,
	projectId: string,
	pinned: boolean,
): Promise<void> {
	const response = await setProjectPinned({
		...remoteOptions(access),
		path: { projectId },
		body: { pinned },
	});
	if (response.error) throw new Error('Could not update the remote project.');
}

export async function forgetMachineProject(
	access: ReadyMachineAccess,
	projectId: string,
): Promise<void> {
	const response = await forgetProject({
		...remoteOptions(access),
		path: { projectId },
	});
	if (response.error) throw new Error('Could not forget the remote project.');
}

/**
 * Stages a strictly newer official daemon release on the remote host via the
 * generated operation, authorized with the machine owner session. The remote
 * daemon is never replaced or restarted by this call: the host owner must
 * activate the staged binary by restarting the daemon.
 */
export async function stageRemoteHostUpgrade(
	apiUrl: string,
	ownerSession: string,
	targetVersion: string,
): Promise<{ stagedPath: string }> {
	const response = await stageServerUpgrade({
		baseURL: apiUrl,
		headers: { 'X-Otto-Owner-Session': ownerSession },
		body: { targetVersion },
	});
	if (response.error || !response.data) {
		const detail =
			response.error &&
			typeof response.error === 'object' &&
			'error' in response.error &&
			typeof (response.error as { error?: unknown }).error === 'string'
				? (response.error as { error: string }).error
				: 'The machine rejected the upgrade request.';
		throw new Error(detail);
	}
	return { stagedPath: response.data.stagedPath };
}

/** Queues a capability-gated supervised restart on the remote daemon. */
export async function restartRemoteHost(
	access: ReadyMachineAccess,
	targetVersion?: string,
): Promise<void> {
	const response = await restartServer({
		...remoteOptions(access),
		body: targetVersion ? { targetVersion } : {},
	});
	if (response.error) {
		const detail =
			response.error &&
			typeof response.error === 'object' &&
			'error' in response.error &&
			typeof (response.error as { error?: unknown }).error === 'string'
				? (response.error as { error: string }).error
				: 'The machine rejected the restart request.';
		throw new Error(detail);
	}
}

export async function loadMachineDevices(): Promise<MachineDeviceState> {
	const response = await listOttoRouterDevices();
	if (response.error)
		throw new Error('Local daemon machine service unavailable.');
	return response.data as MachineDeviceState;
}

export async function startOttoRouterSignIn(): Promise<{
	sessionId: string;
	verificationUri: string;
	interval: number;
}> {
	const response = await startOttoRouterDeviceFlow();
	if (response.error) throw new Error('Could not start OttoRouter sign-in.');
	return response.data as {
		sessionId: string;
		verificationUri: string;
		interval: number;
	};
}

export async function pollOttoRouterSignIn(sessionId: string): Promise<{
	status: 'pending' | 'complete' | 'error';
	error?: string;
}> {
	const response = await pollOttoRouterDeviceFlow({ body: { sessionId } });
	if (response.error) throw new Error('Could not complete OttoRouter sign-in.');
	return response.data as {
		status: 'pending' | 'complete' | 'error';
		error?: string;
	};
}

export async function signOutOttoRouter(): Promise<void> {
	const response = await removeProvider({ path: { provider: 'ottorouter' } });
	if (response.error) throw new Error('Could not disconnect OttoRouter.');
	const result = response.data as {
		success: boolean;
		tunnelDisabled?: boolean;
		authRemoved?: boolean;
		error?: string;
	};
	if (!result.success) {
		throw new Error(
			result.error ?? 'OttoRouter disconnected with cleanup errors.',
		);
	}
}
