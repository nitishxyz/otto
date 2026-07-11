import { loadMachineDevices, type MachineDeviceState } from './machine-api';

export const MACHINE_AUTH_CHANGED_EVENT = 'otto:machine-auth-changed';

export interface MachineAccountSnapshot {
	/** Last known daemon answer; null until the first load resolves. */
	state: MachineDeviceState | null;
	/** True while a load is in flight (including the initial one). */
	loading: boolean;
}

export interface MachineAccountStore {
	getSnapshot: () => MachineAccountSnapshot;
	subscribe: (listener: () => void) => () => void;
	/** Deduped refresh: concurrent callers share one in-flight request. */
	refresh: () => Promise<void>;
}

const DAEMON_UNAVAILABLE_STATE: MachineDeviceState = {
	configured: false,
	devices: [],
	error: 'The local Otto daemon is unavailable. Retry once it has started.',
};

/**
 * Single shared cache for the daemon-owned OttoRouter account/device state.
 * The landing header and the Machines tab read the same snapshot, so the
 * header can render connected state on initial mount without the
 * visibility-gated Machines panel, and both stay synchronized after
 * connect/disconnect/focus/auth-expiry refreshes without duplicate requests.
 */
export function createMachineAccountStore(
	fetcher: () => Promise<MachineDeviceState>,
): MachineAccountStore {
	let snapshot: MachineAccountSnapshot = { state: null, loading: false };
	let inflight: Promise<void> | null = null;
	const listeners = new Set<() => void>();

	const setSnapshot = (next: MachineAccountSnapshot) => {
		snapshot = next;
		for (const listener of listeners) listener();
	};

	const refresh = (): Promise<void> => {
		if (inflight) return inflight;
		setSnapshot({ state: snapshot.state, loading: true });
		inflight = fetcher()
			.then((state) => {
				setSnapshot({ state, loading: false });
			})
			.catch(() => {
				setSnapshot({ state: DAEMON_UNAVAILABLE_STATE, loading: false });
			})
			.finally(() => {
				inflight = null;
			});
		return inflight;
	};

	return {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		refresh,
	};
}

export const machineAccountStore = createMachineAccountStore(() =>
	loadMachineDevices(),
);
