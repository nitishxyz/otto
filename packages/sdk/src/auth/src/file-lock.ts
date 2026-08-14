import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_WAIT_MS = 20_000;
const DEFAULT_POLL_MS = 100;

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
	const ownerPath = join(lockPath, 'owner');
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
			if (!stat || stat.mtimeMs < Date.now() - staleMs) {
				await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
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
		const currentOwner = await fs.readFile(ownerPath, 'utf8').catch(() => null);
		if (currentOwner === owner) {
			await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
		}
	};
}
