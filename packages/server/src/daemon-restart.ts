export const REMOTE_DAEMON_RESTART_CAPABILITY = 'remote.daemon.restart';

export interface DaemonRestartRequest {
	executable?: string;
	targetVersion?: string;
}

export type DaemonRestartHandler = (request: DaemonRestartRequest) => void;

let restartHandler: DaemonRestartHandler | null = null;

/** Registers the process-owner callback that can perform a supervised handoff. */
export function setDaemonRestartHandler(
	handler: DaemonRestartHandler | null,
): void {
	restartHandler = handler;
}

/** True only while this server is owned by a supervisor-capable daemon process. */
export function isDaemonRestartAvailable(): boolean {
	return restartHandler !== null;
}

/** Queues a supervised daemon handoff or rejects unsupported server modes. */
export function requestDaemonRestart(request: DaemonRestartRequest): void {
	if (!restartHandler) {
		throw new Error('Supervised daemon restart is unavailable');
	}
	restartHandler(request);
}
