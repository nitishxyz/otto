import { removeAuth, type ProviderId } from '@ottocode/sdk';
import { stopTunnel } from '../tunnel/service.ts';

export interface OttoRouterDisconnectResult {
	success: boolean;
	provider: 'ottorouter';
	tunnelDisabled: boolean;
	authRemoved: boolean;
	error?: string;
}

type StopManagedTunnel = () => Promise<{ ok: boolean; error?: string }>;
type RemoveProviderAuth = (
	provider: ProviderId,
	projectRoot?: string,
	scope?: 'global' | 'local',
) => Promise<void>;

let stopManagedTunnel: StopManagedTunnel = () =>
	stopTunnel({ mode: 'managed', scope: 'remote-control' });
let removeProviderAuth: RemoveProviderAuth = removeAuth;

/** Disables managed remote access before always removing OttoRouter auth. */
export async function disconnectOttoRouter(): Promise<OttoRouterDisconnectResult> {
	let tunnelDisabled = false;
	let tunnelError: string | undefined;
	try {
		const stopped = await stopManagedTunnel();
		tunnelDisabled = stopped.ok;
		if (!stopped.ok)
			tunnelError = stopped.error ?? 'Managed tunnel disable failed';
	} catch (error) {
		tunnelError = error instanceof Error ? error.message : String(error);
	}

	let authRemoved = false;
	let authError: string | undefined;
	try {
		await removeProviderAuth('ottorouter', undefined, 'global');
		authRemoved = true;
	} catch (error) {
		authError = error instanceof Error ? error.message : String(error);
	}

	const errors = [
		tunnelError ? `Managed tunnel: ${tunnelError}` : undefined,
		authError ? `Credentials: ${authError}` : undefined,
	].filter((value): value is string => Boolean(value));
	return {
		success: tunnelDisabled && authRemoved,
		provider: 'ottorouter',
		tunnelDisabled,
		authRemoved,
		...(errors.length ? { error: errors.join('; ') } : {}),
	};
}

export const ottoRouterDisconnectTesting = {
	setStopManagedTunnel(stop: StopManagedTunnel) {
		stopManagedTunnel = stop;
	},
	setRemoveProviderAuth(remove: RemoveProviderAuth) {
		removeProviderAuth = remove;
	},
	reset() {
		stopManagedTunnel = () =>
			stopTunnel({ mode: 'managed', scope: 'remote-control' });
		removeProviderAuth = removeAuth;
	},
};
