import type { RawTunnelStatus } from './tunnel-shared';

/**
 * Inputs shared by the Connections sidebar sections: the authoritative
 * managed remote-control tunnel status plus the OttoRouter connection flag
 * reported by the daemon.
 */
export interface TunnelViewInput {
	managedStatus: RawTunnelStatus;
	ottorouterConnected: boolean;
}

export type RemoteControlView =
	| 'managed-live'
	| 'managed-starting'
	| 'managed-error'
	| 'managed-off'
	| 'ottorouter-disconnected';

/**
 * Resolves which Remote Control panel to show. The managed slot is
 * authoritative: a live, starting, or errored managed tunnel always wins over
 * the OttoRouter flag (covers auto-restored tunnels racing the first status
 * poll), so a live managed tunnel can never render as "off".
 */
export function resolveRemoteControlView(
	input: TunnelViewInput,
): RemoteControlView {
	if (input.managedStatus === 'connected') return 'managed-live';
	if (input.managedStatus === 'starting') return 'managed-starting';
	if (input.managedStatus === 'error') return 'managed-error';
	return input.ottorouterConnected ? 'managed-off' : 'ottorouter-disconnected';
}

export type ProjectShareView =
	| 'managed-shares'
	| 'managed-shares-waiting'
	| 'quick-share';

/**
 * Resolves the Project Share section. Managed share links are available when
 * the managed remote-control tunnel is online; while it is off/starting with
 * OttoRouter connected the section explains the prerequisite; the temporary
 * quick share is primary only when OttoRouter is disconnected.
 */
export function resolveProjectShareView(
	input: TunnelViewInput,
): ProjectShareView {
	if (input.managedStatus === 'connected') return 'managed-shares';
	if (input.ottorouterConnected || input.managedStatus !== 'idle') {
		return 'managed-shares-waiting';
	}
	return 'quick-share';
}
