import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_WAIT_MS = 20_000;
const DEFAULT_POLL_MS = 100;

async function removeClaimedLock(
	lockPath: string,
	ownerPath: string,
	expectedOwner: string,
): Promise<boolean> {
	const fs = await import('node:fs/promises');
	const claimPath = join(lockPath, `owner-claim-${randomUUID()}`);
	try {
		await fs.rename(ownerPath, claimPath);
	} catch {
		return false;
	}

	const claimedOwner = await fs.readFile(claimPath, 'utf8').catch(() => null);
	if (claimedOwner !== expectedOwner) {
		await fs.rename(claimPath, ownerPath).catch(() => {});
		return false;
	}
	await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
	return true;
}

export interface FileLockOptions {
	staleMs?: number;
	waitMs?: number;
	pollMs?: number;
}

/** Acquire an inter-process directory lock and release only the owned lock. */
export async function acquireFileLock(
	lockPath: string,
	options: FileLockOptions = {},
): Promise<() => Promise<void>> {
	const fs = await import('node:fs/promises');
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
	const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
	const deadline = Date.now() + waitMs;
	const owner = `${process.pid}:${randomUUID()}`;
	const ownerName = `owner-${randomUUID()}`;
	const ownerPath = join(lockPath, ownerName);
	await fs.mkdir(dirname(lockPath), { recursive: true });

	for (;;) {
		try {
			await fs.mkdir(lockPath, { recursive: false });
			try {
				await fs.writeFile(ownerPath, owner, { encoding: 'utf8', flag: 'wx' });
			} catch (error) {
				await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
				throw error;
			}
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			const stat = await fs.stat(lockPath).catch(() => null);
			if (!stat) continue;
			if (stat.mtimeMs < Date.now() - staleMs) {
				const staleOwnerName = (
					await fs.readdir(lockPath).catch(() => [])
				).find((name) => name === 'owner' || name.startsWith('owner-'));
				if (staleOwnerName) {
					const staleOwnerPath = join(lockPath, staleOwnerName);
					const staleOwner = await fs
						.readFile(staleOwnerPath, 'utf8')
						.catch(() => null);
					if (staleOwner) {
						await removeClaimedLock(lockPath, staleOwnerPath, staleOwner);
					}
				}
				continue;
			}
			if (Date.now() >= deadline) {
				throw new Error(`Timed out waiting for file lock: ${lockPath}`);
			}
			await new Promise((resolve) => setTimeout(resolve, pollMs));
		}
	}

	const heartbeat = setInterval(
		() => {
			const now = new Date();
			void fs.utimes(lockPath, now, now).catch(() => {});
		},
		Math.max(1000, Math.floor(staleMs / 3)),
	);
	heartbeat.unref?.();

	return async () => {
		clearInterval(heartbeat);
		await removeClaimedLock(lockPath, ownerPath, owner);
	};
}
