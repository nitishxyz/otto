import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireRegistryLock } from '../packages/server/src/runtime/projects/registry-lock';

async function fixture(run: (path: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'otto-registry-lock-'));
	try {
		await run(join(root, 'projects.json'));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function replaceOwner(path: string, identity: string, pid: number): void {
	const db = new Database(`${path}.lock.sqlite`);
	try {
		db.query(
			'UPDATE owner SET identity = ?, pid = ?, hostname = ?, acquiredAt = ? WHERE singleton = 1',
		).run(identity, pid, hostname(), Date.now());
	} finally {
		db.close();
	}
}

test('registry lock recovers a crashed owner', async () => {
	await fixture(async (path) => {
		const child = Bun.spawn([process.execPath, '-e', ''], {
			stdout: 'ignore',
			stderr: 'ignore',
		});
		await child.exited;
		const lock = await acquireRegistryLock(path);
		replaceOwner(path, 'dead-owner', child.pid);
		lock.release();
		const recovered = await acquireRegistryLock(path, 200);
		recovered.release();
	});
});

test('registry lock does not steal a live owner and proceeds after release', async () => {
	await fixture(async (path) => {
		const owner = await acquireRegistryLock(path);
		try {
			await expect(acquireRegistryLock(path, 30)).rejects.toThrow('Timed out');
		} finally {
			owner.release();
		}
		const next = await acquireRegistryLock(path, 200);
		next.release();
	});
});

test('release cannot delete replacement ownership', async () => {
	await fixture(async (path) => {
		const owner = await acquireRegistryLock(path);
		replaceOwner(path, 'replacement', process.pid);
		owner.release();
		const db = new Database(`${path}.lock.sqlite`);
		try {
			expect(
				db.query<{ identity: string }, []>('SELECT identity FROM owner').get()
					?.identity,
			).toBe('replacement');
		} finally {
			db.close();
		}
		await expect(acquireRegistryLock(path, 30)).rejects.toThrow('Timed out');
	});
});

test('foreign-host owner is never declared dead from local PID lookup', async () => {
	await fixture(async (path) => {
		const owner = await acquireRegistryLock(path);
		const db = new Database(`${path}.lock.sqlite`);
		db.run("UPDATE owner SET hostname = 'another-host', pid = 2147483647");
		db.close();
		try {
			await expect(acquireRegistryLock(path, 30)).rejects.toThrow('Timed out');
		} finally {
			owner.release();
		}
	});
});
