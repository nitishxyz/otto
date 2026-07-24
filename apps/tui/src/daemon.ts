import { join } from 'node:path';
import { getOttoHomeDir } from '@ottocode/sdk';

const HEALTH_TIMEOUT_MS = 1500;

export interface DaemonConnection {
	baseUrl: string;
	token: string | null;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
	try {
		return (await Bun.file(path).json()) as Record<string, unknown>;
	} catch {
		return null;
	}
}

async function readToken(path: string): Promise<string | null> {
	try {
		return (await Bun.file(path).text()).trim() || null;
	} catch {
		return null;
	}
}

async function isHealthy(baseUrl: string, token: string | null): Promise<boolean> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
	try {
		const response = await fetch(`${baseUrl}/v1/server/info`, {
			headers: token
				? {
						Authorization: `Bearer ${token}`,
						'X-Otto-Server-Token': token,
					}
				: {},
			signal: controller.signal,
		});
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Discovers a running local otto daemon via its registration file
 * (`$OTTO_HOME/server.json` + `server-token`) and verifies it responds.
 * Returns null when no healthy daemon is found.
 */
export async function discoverLocalDaemon(): Promise<DaemonConnection | null> {
	const dir = getOttoHomeDir();
	const registration = await readJson(join(dir, 'server.json'));
	const url = typeof registration?.url === 'string' ? registration.url : null;
	if (!url) return null;
	const token = await readToken(join(dir, 'server-token'));
	if (!(await isHealthy(url, token))) return null;
	return { baseUrl: url, token };
}
