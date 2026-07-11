export type MachinePresence = 'checking' | 'online' | 'offline';

const ONLINE_STATUSES = new Set(['online', 'active', 'connected', 'ready']);
const OFFLINE_STATUSES = new Set([
	'offline',
	'inactive',
	'disconnected',
	'unreachable',
	'error',
	'down',
]);

/**
 * Normalizes provider-reported machine status strings into the accessible
 * badge states used by the Machines tab. Unknown statuses stay in
 * `checking` rather than guessing online/offline.
 */
export function machinePresence(
	status: string | null | undefined,
	refreshing = false,
): MachinePresence {
	if (refreshing) return 'checking';
	const normalized = status?.trim().toLowerCase() ?? '';
	if (ONLINE_STATUSES.has(normalized)) return 'online';
	if (OFFLINE_STATUSES.has(normalized)) return 'offline';
	return 'checking';
}
