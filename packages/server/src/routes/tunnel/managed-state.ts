import { chmod, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getOttoHomeDir } from '@ottocode/sdk';

export interface ManagedTunnelDesiredState {
	enabled: boolean;
}

/** Returns the private daemon-managed tunnel desired-state path. */
export function getManagedTunnelStatePath(): string {
	return join(getOttoHomeDir(), 'managed-tunnel.json');
}

/** Reads desired managed tunnel state, defaulting safely to disabled. */
export async function readManagedTunnelDesiredState(
	path = getManagedTunnelStatePath(),
): Promise<ManagedTunnelDesiredState> {
	try {
		const value = (await Bun.file(path).json()) as Record<string, unknown>;
		return { enabled: value.enabled === true };
	} catch {
		return { enabled: false };
	}
}

/** Atomically persists only whether the managed daemon tunnel is desired. */
export async function writeManagedTunnelDesiredState(
	enabled: boolean,
	path = getManagedTunnelStatePath(),
): Promise<void> {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await Bun.write(temporaryPath, `${JSON.stringify({ enabled })}\n`);
	await chmod(temporaryPath, 0o600);
	await rename(temporaryPath, path);
	await chmod(path, 0o600).catch(() => {});
}
