import { useEffect, useSyncExternalStore } from 'react';
import {
	managedTunnelStore,
	type ManagedTunnelSnapshot,
} from '../lib/managed-tunnel-store';
import { MACHINE_AUTH_CHANGED_EVENT } from '../lib/machine-account-store';

const STARTING_POLL_MS = 2_500;

export interface ManagedTunnel extends ManagedTunnelSnapshot {
	refresh: () => Promise<void>;
	enable: () => Promise<void>;
	disable: () => Promise<void>;
}

/**
 * Shared managed tunnel state for the Machines tab. Refreshes on mount (tab
 * activation, since the panel is visibility-gated) and window focus, and
 * polls only while the tunnel is starting or an action is pending so daemon
 * auto-restore state converges without request storms (refreshes dedupe in
 * the store).
 */
export function useManagedTunnel(): ManagedTunnel {
	const snapshot = useSyncExternalStore(
		managedTunnelStore.subscribe,
		managedTunnelStore.getSnapshot,
	);

	useEffect(() => {
		void managedTunnelStore.refresh();
		const refresh = () => void managedTunnelStore.refresh();
		window.addEventListener('focus', refresh);
		window.addEventListener(MACHINE_AUTH_CHANGED_EVENT, refresh);
		return () => {
			window.removeEventListener('focus', refresh);
			window.removeEventListener(MACHINE_AUTH_CHANGED_EVENT, refresh);
		};
	}, []);

	const settling = snapshot.status?.state === 'starting' || snapshot.pending;
	useEffect(() => {
		if (!settling) return;
		const interval = window.setInterval(() => {
			void managedTunnelStore.refresh();
		}, STARTING_POLL_MS);
		return () => window.clearInterval(interval);
	}, [settling]);

	return {
		...snapshot,
		refresh: managedTunnelStore.refresh,
		enable: managedTunnelStore.enable,
		disable: managedTunnelStore.disable,
	};
}
