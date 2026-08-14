import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOttoHomeDir } from '../config/src/paths.ts';

const DEFAULT_OTTOROUTER_BASE_URL = 'https://api.ottorouter.org';
const DEVICE_ID_FILE = 'device-id';
const MACHINE_ID_FILE = 'machine-id';
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** OttoRouter bearer credentials accepted by managed tunnel provisioning. */
export interface ManagedTunnelAuth {
	accessToken: string;
}

/** Runtime daemon metadata sent when provisioning a managed tunnel. */
export interface ManagedTunnelProvisionOptions {
	daemonVersion: string;
	localPort: number;
	name?: string;
	baseUrl?: string;
	ottoHome?: string;
	fetch?: typeof globalThis.fetch;
}

/** Managed tunnel details returned by OttoRouter. */
export interface ManagedTunnelProvision {
	slug: string;
	hostname: string;
	url: string;
	tunnel_token: string;
}

/** HTTP failure returned while provisioning a managed tunnel. */
export class ManagedTunnelProvisionError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'ManagedTunnelProvisionError';
		this.status = status;
	}
}

/** Returns whether a value is a canonical UUID accepted as a tunnel device ID. */
export function isManagedTunnelDeviceId(value: string): boolean {
	return UUID_PATTERN.test(value);
}

async function getPersistentId(
	ottoHome: string,
	filename: string,
): Promise<string> {
	const path = join(ottoHome, filename);
	let replaceInvalid = false;
	try {
		const existing = (await readFile(path, 'utf8')).trim();
		if (isManagedTunnelDeviceId(existing)) return existing;
		replaceInvalid = true;
	} catch {}

	await mkdir(ottoHome, { recursive: true, mode: 0o700 });
	const deviceId = randomUUID();
	if (replaceInvalid) {
		await writeFile(path, `${deviceId}\n`, { encoding: 'utf8', mode: 0o600 });
		return deviceId;
	}
	try {
		await writeFile(path, `${deviceId}\n`, {
			encoding: 'utf8',
			flag: 'wx',
			mode: 0o600,
		});
		return deviceId;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		const existing = (await readFile(path, 'utf8')).trim();
		if (!isManagedTunnelDeviceId(existing)) {
			throw new Error('Existing Otto managed tunnel device ID is invalid');
		}
		return existing;
	}
}

/** Read or generate the persistent UUID that identifies this Otto instance. */
export function getManagedTunnelDeviceId(
	ottoHome = getOttoHomeDir(),
): Promise<string> {
	return getPersistentId(ottoHome, DEVICE_ID_FILE);
}

/** Read or generate the persistent UUID for this machine's tunnel connector. */
export function getManagedTunnelMachineId(
	ottoHome = getOttoHomeDir(),
): Promise<string> {
	return getPersistentId(ottoHome, MACHINE_ID_FILE);
}

/** Provision the named Cloudflare tunnel assigned to this Otto daemon. */
export async function provisionManagedTunnel(
	auth: ManagedTunnelAuth,
	options: ManagedTunnelProvisionOptions,
): Promise<ManagedTunnelProvision> {
	if (!auth.accessToken) {
		throw new Error('OttoRouter bearer token is required');
	}
	if (
		!Number.isInteger(options.localPort) ||
		options.localPort < 1 ||
		options.localPort > 65_535
	) {
		throw new Error(
			'Managed tunnel local port must be an integer from 1 to 65535',
		);
	}

	const [deviceId, machineId] = await Promise.all([
		getManagedTunnelDeviceId(options.ottoHome),
		getManagedTunnelMachineId(options.ottoHome),
	]);
	const baseUrl = (
		options.baseUrl ??
		process.env.OTTOROUTER_BASE_URL ??
		DEFAULT_OTTOROUTER_BASE_URL
	).replace(/\/$/, '');
	const fetcher = options.fetch ?? globalThis.fetch;
	const response = await fetcher(`${baseUrl}/v1/tunnels/device`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${auth.accessToken}`,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			device_id: deviceId,
			machine_id: machineId,
			daemon_version: options.daemonVersion,
			local_port: options.localPort,
			...(options.name === undefined ? {} : { name: options.name }),
		}),
	});
	const payload = (await response.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	if (!response.ok) {
		const code =
			payload && typeof payload.error === 'string'
				? payload.error
				: `HTTP ${response.status}`;
		throw new ManagedTunnelProvisionError(
			response.status,
			`OttoRouter managed tunnel provisioning failed: ${code}`,
		);
	}

	const device = payload?.device;
	const slug =
		device && typeof device === 'object'
			? (device as Record<string, unknown>).slug
			: undefined;
	if (
		typeof slug !== 'string' ||
		typeof payload?.hostname !== 'string' ||
		typeof payload.url !== 'string' ||
		typeof payload.tunnel_token !== 'string'
	) {
		throw new Error('OttoRouter managed tunnel response was invalid');
	}

	return {
		slug,
		hostname: payload.hostname,
		url: payload.url,
		tunnel_token: payload.tunnel_token,
	};
}
