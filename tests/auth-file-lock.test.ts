import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireFileLock } from '../packages/sdk/src/auth/src/file-lock.ts';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function makeLockPath(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'otto-file-lock-test-'));
	tempDirs.push(dir);
	return join(dir, 'auth.lock');
}

describe('acquireFileLock', () => {
	test('stale takeover is not removed by the previous owner release', async () => {
		const lockPath = await makeLockPath();
		const releaseOld = await acquireFileLock(lockPath, {
			staleMs: 5,
			waitMs: 500,
			pollMs: 1,
		});
		await Bun.sleep(10);

		const releaseReplacement = await acquireFileLock(lockPath, {
			staleMs: 5,
			waitMs: 500,
			pollMs: 1,
		});
		await releaseOld();

		const entries = await readdir(lockPath);
		expect(entries.some((entry) => entry.startsWith('owner-'))).toBe(true);

		await releaseReplacement();
		expect(await readdir(lockPath).catch(() => null)).toBeNull();
	});

	test('concurrent callers wait for the current owner', async () => {
		const lockPath = await makeLockPath();
		const releaseFirst = await acquireFileLock(lockPath, {
			staleMs: 1000,
			waitMs: 500,
			pollMs: 1,
		});
		let acquiredSecond = false;
		const second = acquireFileLock(lockPath, {
			staleMs: 1000,
			waitMs: 500,
			pollMs: 1,
		}).then((release) => {
			acquiredSecond = true;
			return release;
		});

		await Bun.sleep(10);
		expect(acquiredSecond).toBe(false);
		await releaseFirst();
		const releaseSecond = await second;
		expect(acquiredSecond).toBe(true);
		await releaseSecond();
	});
});
