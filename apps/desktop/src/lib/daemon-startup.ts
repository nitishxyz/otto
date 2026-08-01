import type { ServerInfo } from './tauri-bridge';

export const DESKTOP_DAEMON_START_RETRIES = 3;
const RETRY_DELAY_MS = 500;

function wait(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Waits through transient daemon shutdown/startup races before surfacing an error. */
export async function ensureDesktopDaemonReady(
	ensureDaemon: () => Promise<ServerInfo>,
	retryDelayMs = RETRY_DELAY_MS,
): Promise<ServerInfo> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await ensureDaemon();
		} catch (cause) {
			if (attempt >= DESKTOP_DAEMON_START_RETRIES) throw cause;
			await wait(retryDelayMs * (attempt + 1));
		}
	}
}
