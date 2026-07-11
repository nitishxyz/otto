import {
	listAuthorizedMachineProjects,
	listOttoRouterDevices,
	pollOttoRouterDeviceFlow,
	removeProvider,
	startOttoRouterDeviceFlow,
} from '@ottocode/api';
import type { MachineBootstrap, MachineProjectAccess } from './tauri-bridge';

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
): Promise<MachineProjectAccess> {
	if (!machine.hostname) {
		return {
			status: 'unavailable',
			message: 'This machine has no tunnel hostname.',
		};
	}
	const response = await listAuthorizedMachineProjects({
		body: { deviceId: machine.deviceId, hostname: machine.hostname },
	});
	if (response.error) throw new Error('Machine projects unavailable.');
	return response.data as MachineProjectAccess;
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
}
