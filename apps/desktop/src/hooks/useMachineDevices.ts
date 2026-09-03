import { useEffect, useSyncExternalStore } from 'react';
import type { MachineDeviceState } from '../lib/machine-api';
import {
	MACHINE_AUTH_CHANGED_EVENT,
	machineAccountStore,
} from '../lib/machine-account-store';

const BACKGROUND_REFRESH_MS = 15_000;
const ACTIVE_REFRESH_MS = 3_000;

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
export function useMachineDevices(active = false): MachineDevices {
	const snapshot = useSyncExternalStore(
		machineAccountStore.subscribe,
		machineAccountStore.getSnapshot,
	);

	useEffect(() => {
		void (active
			? machineAccountStore.refreshFresh()
			: machineAccountStore.refresh());
		const refreshFresh = () => void machineAccountStore.refreshFresh();
		const refreshAfterAuthChange = () =>
			void machineAccountStore.refreshFresh();
		const refreshVisible = () => {
			if (document.visibilityState === 'visible') refreshFresh();
		};
		const interval = window.setInterval(
			refreshVisible,
			active ? ACTIVE_REFRESH_MS : BACKGROUND_REFRESH_MS,
		);
		window.addEventListener('focus', refreshFresh);
		document.addEventListener('visibilitychange', refreshVisible);
		window.addEventListener(MACHINE_AUTH_CHANGED_EVENT, refreshAfterAuthChange);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('focus', refreshFresh);
			document.removeEventListener('visibilitychange', refreshVisible);
			window.removeEventListener(
				MACHINE_AUTH_CHANGED_EVENT,
				refreshAfterAuthChange,
			);
		};
	}, [active]);

	return {
		state: snapshot.state,
		loading: snapshot.loading,
		refresh: machineAccountStore.refreshFresh,
	};
}
