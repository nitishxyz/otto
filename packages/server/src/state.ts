/**
 * Server state - tracks runtime information like the server's port
 * This is the single source of truth for server configuration
 */

let serverPort: number | null = null;
let serverVersion: string | null = null;
let daemonId: string | null = process.env.OTTO_DAEMON_ID || null;
let defaultProjectRoot: string | null = null;

export function setServerPort(port: number): void {
	serverPort = port;
}

export function getServerPort(): number | null {
	return serverPort;
}

export function setServerVersion(version: string): void {
	serverVersion = version;
}

export function setDaemonId(id: string | null): void {
	daemonId = id;
}

export function setDefaultProjectRoot(root: string | null): void {
	defaultProjectRoot = root;
}

export function getDefaultProjectRoot(): string | null {
	return defaultProjectRoot;
}

export function getServerInfo(): {
	port: number | null;
	version: string | null;
	pid: number;
	daemonId: string | null;
	startedAt: number;
} {
	return {
		port: serverPort,
		version: serverVersion,
		pid: process.pid,
		daemonId,
		startedAt,
	};
}

const startedAt = Date.now();
