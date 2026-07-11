import { useEffect, useSyncExternalStore } from 'react';
import type { MachineDeviceState } from '../lib/machine-api';
import {
	MACHINE_AUTH_CHANGED_EVENT,
	machineAccountStore,
} from '../lib/machine-account-store';

export interface MachineDevices {
	/** Last known daemon answer; null until the first load resolves. */
	state: MachineDeviceState | null;
	/** True while a load is in flight. */
	loading: boolean;
	refresh: () => Promise<void>;
}

/**
 * Shared OttoRouter account/device state for the landing page. Loads
 * immediately on first mount (after daemon bootstrap) and refreshes on window
 * focus and auth changes; all consumers share one cache and in-flight
 * request, so mounting the hook in several components never duplicates polls.
 */
export function useMachineDevices(): MachineDevices {
	const snapshot = useSyncExternalStore(
		machineAccountStore.subscribe,
		machineAccountStore.getSnapshot,
	);

	useEffect(() => {
		void machineAccountStore.refresh();
		const refresh = () => void machineAccountStore.refresh();
		window.addEventListener('focus', refresh);
		window.addEventListener(MACHINE_AUTH_CHANGED_EVENT, refresh);
		return () => {
			window.removeEventListener('focus', refresh);
			window.removeEventListener(MACHINE_AUTH_CHANGED_EVENT, refresh);
		};
	}, []);

	return {
		state: snapshot.state,
		loading: snapshot.loading,
		refresh: machineAccountStore.refresh,
	};
}
