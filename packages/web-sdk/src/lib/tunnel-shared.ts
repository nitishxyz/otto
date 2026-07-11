/**
 * Platform-neutral tunnel helpers shared by the web-sdk tunnel hooks and the
 * desktop landing page (which consumes the daemon through the generated
 * `@ottocode/api` client without react-query).
 */

/** Query/body payload for the managed remote-control (whole daemon) tunnel. */
export const MANAGED_REMOTE_CONTROL = {
	mode: 'managed',
	scope: 'remote-control',
} as const;

export type RawTunnelStatus = 'idle' | 'starting' | 'connected' | 'error';

/**
 * Smooths daemon race windows where the process is already running but the
 * URL is not published yet (or vice versa) so the UI never flashes idle
 * mid-startup.
 */
export function normalizeTunnelStatus(data: {
	status: RawTunnelStatus;
	url: string | null;
	isRunning?: boolean;
}): RawTunnelStatus {
	if (data.isRunning && data.url) return 'connected';
	if (data.isRunning && data.status === 'idle') return 'starting';
	if (data.status === 'connected' && !data.url) return 'starting';
	return data.status;
}

/**
 * Converts tunnel start/stop response bodies into readable messages —
 * typed codes such as `ottorouter_not_connected` become actionable text,
 * never a raw serialized error.
 */
export function describeTunnelActionError(payload: unknown): string {
	const record = (payload ?? {}) as Record<string, unknown>;
	if (record.code === 'ottorouter_not_connected') {
		return 'Connect OttoRouter before enabling remote access.';
	}
	if (typeof record.error === 'string' && record.error) return record.error;
	if (typeof record.message === 'string' && record.message)
		return record.message;
	return 'The managed tunnel request failed. Retry once the daemon is reachable.';
}
