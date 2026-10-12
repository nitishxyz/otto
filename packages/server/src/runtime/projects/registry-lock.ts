import { Database } from 'bun:sqlite';
import { hostname } from 'node:os';

interface LockOwner {
	identity: string;
	pid: number;
	hostname: string;
	acquiredAt: number;
}

function isDeadOwner(owner: LockOwner): boolean {
	if (
		owner.hostname !== hostname() ||
		!Number.isSafeInteger(owner.pid) ||
		owner.pid <= 0
	)
		return false;
	try {
		process.kill(owner.pid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'ESRCH';
	}
}

/**
 * Acquire project registry ownership. SQLite transactions provide atomic claim,
 * dead-owner replacement and token-checked release without unlink/rename races.
 * The ownership database stays on disk; age alone never evicts a live owner.
 */
export async function acquireRegistryLock(
	registryPath: string,
	timeoutMs = 10_000,
): Promise<{ release(): void }> {
	const db = new Database(`${registryPath}.lock.sqlite`, {
		create: true,
		strict: true,
	});
	const identity = crypto.randomUUID();
	const deadline = Date.now() + timeoutMs;
	try {
		db.run('PRAGMA busy_timeout = 20');
		db.run(
			'CREATE TABLE IF NOT EXISTS owner (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), identity TEXT NOT NULL, pid INTEGER NOT NULL, hostname TEXT NOT NULL, acquiredAt INTEGER NOT NULL)',
		);
		const claim = db.transaction(() => {
			const owner = db
				.query<LockOwner, []>(
					'SELECT identity, pid, hostname, acquiredAt FROM owner WHERE singleton = 1',
				)
				.get();
			if (owner && !isDeadOwner(owner)) return false;
			db.query(
				'INSERT OR REPLACE INTO owner (singleton, identity, pid, hostname, acquiredAt) VALUES (1, ?, ?, ?, ?)',
			).run(identity, process.pid, hostname(), Date.now());
			return true;
		});
		while (true) {
			try {
				if (claim.immediate()) break;
			} catch (error) {
				if ((error as { code?: string }).code !== 'SQLITE_BUSY') throw error;
			}
			if (Date.now() >= deadline)
				throw new Error(
					`Timed out acquiring project registry lock: ${registryPath}`,
				);
			await Bun.sleep(20);
		}
	} catch (error) {
		db.close();
		throw error;
	}
	let released = false;
	return {
		release() {
			if (released) return;
			released = true;
			try {
				db.query('DELETE FROM owner WHERE singleton = 1 AND identity = ?').run(
					identity,
				);
			} finally {
				db.close();
			}
		},
	};
}
