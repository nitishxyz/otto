import { useEffect, useSyncExternalStore } from 'react';
import type { MachineDeviceState } from '../lib/machine-api';
import {
	MACHINE_AUTH_CHANGED_EVENT,
	machineAccountStore,
} from '../lib/machine-account-store';

const PRESENCE_REFRESH_MS = 15_000;

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
		const refreshVisible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		const interval = window.setInterval(refreshVisible, PRESENCE_REFRESH_MS);
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refreshVisible);
		window.addEventListener(MACHINE_AUTH_CHANGED_EVENT, refresh);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refreshVisible);
			window.removeEventListener(MACHINE_AUTH_CHANGED_EVENT, refresh);
		};
	}, []);

	return {
		state: snapshot.state,
		loading: snapshot.loading,
		refresh: machineAccountStore.refresh,
	};
}
