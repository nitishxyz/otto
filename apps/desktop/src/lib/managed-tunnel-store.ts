import { getTunnelStatus, startTunnel, stopTunnel } from '@ottocode/api';

export type ManagedTunnelState = 'off' | 'starting' | 'online' | 'error';

export interface ManagedTunnelStatus {
	state: ManagedTunnelState;
	hostname: string | null;
	url: string | null;
	error: string | null;
	ottorouterConnected: boolean;
}

export interface ManagedTunnelSnapshot {
	/** Last known daemon answer; null until the first load resolves. */
	status: ManagedTunnelStatus | null;
	/** True while a status load is in flight. */
	loading: boolean;
	/** Pending user action, used to disable controls and block double actions. */
	pending: 'enable' | 'disable' | null;
	/** Typed error from the last enable/disable action. */
	actionError: string | null;
}

interface TunnelApi {
	status: () => Promise<{ data?: unknown; error?: unknown }>;
	start: () => Promise<{ data?: unknown; error?: unknown }>;
	stop: () => Promise<{ data?: unknown; error?: unknown }>;
}

export interface ManagedTunnelStore {
	getSnapshot: () => ManagedTunnelSnapshot;
	subscribe: (listener: () => void) => () => void;
	/** Deduped status refresh; concurrent callers share one request. */
	refresh: () => Promise<void>;
	enable: () => Promise<void>;
	disable: () => Promise<void>;
}

const MANAGED_QUERY = { mode: 'managed', scope: 'remote-control' } as const;

/** Maps daemon tunnel status payloads onto the four landing badge states. */
export function toManagedTunnelStatus(payload: unknown): ManagedTunnelStatus {
	const record = (payload ?? {}) as Record<string, unknown>;
	const raw = typeof record.status === 'string' ? record.status : 'idle';
	const state: ManagedTunnelState =
		raw === 'connected'
			? 'online'
			: raw === 'starting'
				? 'starting'
				: raw === 'error'
					? 'error'
					: 'off';
	return {
		state,
		hostname: typeof record.hostname === 'string' ? record.hostname : null,
		url: typeof record.url === 'string' ? record.url : null,
		error: typeof record.error === 'string' ? record.error : null,
		ottorouterConnected: record.ottorouterConnected === true,
	};
}

/** Converts start/stop response bodies into readable messages, never a raw TypeError. */
export function toManagedTunnelActionError(payload: unknown): string {
	const record = (payload ?? {}) as Record<string, unknown>;
	if (record.code === 'ottorouter_not_connected') {
		return 'Connect OttoRouter before enabling remote access.';
	}
	if (typeof record.error === 'string' && record.error) return record.error;
	if (typeof record.message === 'string' && record.message)
		return record.message;
	return 'The managed tunnel request failed. Retry once the daemon is reachable.';
}

/**
 * Shared managed remote-control tunnel state for the landing Machines tab.
 * Uses the generated daemon client only; enabling starts
 * `{mode:'managed', scope:'remote-control'}` and disabling stops it so the
 * daemon persists desired state off. Status refreshes are deduped so the
 * panel, focus handlers, and starting-poll never stack requests.
 */
export function createManagedTunnelStore(api: TunnelApi): ManagedTunnelStore {
	let snapshot: ManagedTunnelSnapshot = {
		status: null,
		loading: false,
		pending: null,
		actionError: null,
	};
	let inflight: Promise<void> | null = null;
	const listeners = new Set<() => void>();

	const setSnapshot = (next: Partial<ManagedTunnelSnapshot>) => {
		snapshot = { ...snapshot, ...next };
		for (const listener of listeners) listener();
	};

	const refresh = (): Promise<void> => {
		if (inflight) return inflight;
		setSnapshot({ loading: true });
		inflight = api
			.status()
			.then((response) => {
				if (response.error || !response.data) {
					throw new Error('Tunnel status unavailable.');
				}
				setSnapshot({
					status: toManagedTunnelStatus(response.data),
					loading: false,
				});
			})
			.catch(() => {
				setSnapshot({
					status: {
						state: 'error',
						hostname: null,
						url: null,
						error:
							'The local Otto daemon did not report tunnel status. Retry once it has started.',
						ottorouterConnected: false,
					},
					loading: false,
				});
			})
			.finally(() => {
				inflight = null;
			});
		return inflight;
	};

	const runAction = async (
		kind: 'enable' | 'disable',
		call: () => Promise<{ data?: unknown; error?: unknown }>,
	) => {
		if (snapshot.pending) return;
		setSnapshot({ pending: kind, actionError: null });
		try {
			const response = await call();
			const body = (response.data ?? response.error) as
				| Record<string, unknown>
				| undefined;
			if (response.error || !body || body.ok !== true) {
				setSnapshot({ actionError: toManagedTunnelActionError(body) });
			}
		} catch {
			setSnapshot({
				actionError:
					'The local Otto daemon is unreachable. Retry once it has started.',
			});
		} finally {
			setSnapshot({ pending: null });
			await refresh();
		}
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
		enable: () => runAction('enable', api.start),
		disable: () => runAction('disable', api.stop),
	};
}

export const managedTunnelStore = createManagedTunnelStore({
	status: () => getTunnelStatus({ query: MANAGED_QUERY }),
	start: () => startTunnel({ body: MANAGED_QUERY }),
	stop: () => stopTunnel({ query: MANAGED_QUERY }),
});
