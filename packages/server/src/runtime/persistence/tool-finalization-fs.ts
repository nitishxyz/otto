/**
 * Private-directory file primitives for the tool finalization journal and
 * run-owner leases. Nothing is trusted by pathname alone: every operation
 * re-opens the directory with O_NOFOLLOW|O_DIRECTORY, verifies through the
 * descriptor that it is a private (0700) directory owned by this user, and
 * re-checks after the mutation that the path still names that same
 * directory (dev/inode) and that the written file is the one we created.
 * A swap of the directory for a symlink or another directory at any point
 * makes the operation fail instead of writing elsewhere.
 *
 * Node has no openat(), so a same-user attacker who swaps the directory away
 * and back between checks is out of scope (single-host, same-user contract).
 */
import { randomUUID } from 'node:crypto';
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	readdirSync,
	type Stats,
} from 'node:fs';
import { mkdir, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

const IS_WINDOWS = process.platform === 'win32';
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_DIRECTORY = constants.O_DIRECTORY ?? 0;
const DIR_FLAGS = constants.O_RDONLY | O_NOFOLLOW | O_DIRECTORY;

export class UnsafeJournalDirectoryError extends Error {
	constructor(dir: string, reason: string) {
		super(`Unsafe tool journal directory ${dir}: ${reason}`);
		this.name = 'UnsafeJournalDirectoryError';
	}
}

function sameFile(a: Stats, b: Stats): boolean {
	return a.dev === b.dev && a.ino === b.ino;
}

function checkPrivateDir(dir: string, stats: Stats): void {
	if (!stats.isDirectory()) {
		throw new UnsafeJournalDirectoryError(dir, 'not a directory');
	}
	if (IS_WINDOWS) return;
	const uid = process.getuid?.();
	if (uid !== undefined && stats.uid !== uid) {
		throw new UnsafeJournalDirectoryError(dir, 'owned by another user');
	}
}

/** Fails unless `dir` (as a path, not via a symlink) is still `expected`. */
function assertSameDir(dir: string, expected: Stats): void {
	let current: Stats;
	try {
		current = lstatSync(dir);
	} catch {
		throw new UnsafeJournalDirectoryError(dir, 'directory disappeared');
	}
	if (current.isSymbolicLink() || !sameFile(current, expected)) {
		throw new UnsafeJournalDirectoryError(dir, 'directory was replaced');
	}
}

type OpenedDir = { handle: FileHandle; stats: Stats };

/**
 * Opens (creating when allowed) a private directory without following a
 * final symlink, verifying ownership and tightening permissions through the
 * descriptor.
 */
async function openPrivateDir(
	dir: string,
	create: boolean,
): Promise<OpenedDir> {
	if (create) await mkdir(dir, { recursive: true, mode: 0o700 });
	let handle: FileHandle;
	try {
		handle = await open(dir, DIR_FLAGS);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'EMLINK') {
			throw new UnsafeJournalDirectoryError(dir, 'symlink or non-directory');
		}
		throw error;
	}
	try {
		const stats = await handle.stat();
		checkPrivateDir(dir, stats);
		if (!IS_WINDOWS && (stats.mode & 0o077) !== 0) {
			await handle.chmod(0o700);
		}
		assertSameDir(dir, stats);
		return { handle, stats };
	} catch (error) {
		await handle.close();
		throw error;
	}
}

/**
 * Atomically writes `name` inside the private directory `dir`: exclusive
 * O_NOFOLLOW temp file (0600), fsync, rename, then identity re-checks and a
 * directory fsync. `tempPrefix` identifies the writer in the temp name.
 */
export async function writePrivateFileAtomic(
	dir: string,
	name: string,
	data: string,
	tempPrefix: string,
): Promise<void> {
	const opened = await openPrivateDir(dir, true);
	try {
		const temp = join(dir, `${tempPrefix}.${randomUUID()}.tmp`);
		const target = join(dir, name);
		const file = await open(
			temp,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW,
			0o600,
		);
		let fileStats: Stats;
		try {
			fileStats = await file.stat();
			await file.writeFile(data, 'utf8');
			await file.sync();
		} finally {
			await file.close();
		}
		try {
			assertSameDir(dir, opened.stats);
			await rename(temp, target);
		} catch (error) {
			await unlink(temp).catch(() => undefined);
			throw error;
		}
		assertSameDir(dir, opened.stats);
		const written = lstatSync(target);
		if (!written.isFile() || !sameFile(written, fileStats)) {
			throw new UnsafeJournalDirectoryError(dir, 'record was replaced');
		}
		if (!IS_WINDOWS) await opened.handle.sync();
	} finally {
		await opened.handle.close();
	}
}

/** Removes `name` from the private directory. Missing is success. */
export async function removePrivateFile(
	dir: string,
	name: string,
): Promise<void> {
	let opened: OpenedDir;
	try {
		opened = await openPrivateDir(dir, false);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
		throw error;
	}
	try {
		try {
			await unlink(join(dir, name));
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
		}
		assertSameDir(dir, opened.stats);
		if (!IS_WINDOWS) await opened.handle.sync().catch(() => undefined);
	} finally {
		await opened.handle.close();
	}
}

/**
 * Synchronous verified view of an existing private directory, used by
 * recovery. Returns undefined when the directory does not exist; throws
 * UnsafeJournalDirectoryError when it is a symlink, foreign or replaced.
 */
export class PrivateDirReader {
	private constructor(
		readonly dir: string,
		private readonly fd: number,
		private readonly stats: Stats,
	) {}

	static open(dir: string): PrivateDirReader | undefined {
		let fd: number;
		try {
			fd = openSync(dir, DIR_FLAGS);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code;
			if (code === 'ENOENT') return undefined;
			if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'EMLINK') {
				throw new UnsafeJournalDirectoryError(dir, 'symlink or non-directory');
			}
			throw error;
		}
		try {
			const stats = fstatSync(fd);
			checkPrivateDir(dir, stats);
			if (!IS_WINDOWS && (stats.mode & 0o077) !== 0) {
				throw new UnsafeJournalDirectoryError(dir, 'not private (0700)');
			}
			assertSameDir(dir, stats);
			return new PrivateDirReader(dir, fd, stats);
		} catch (error) {
			closeSync(fd);
			throw error;
		}
	}

	/** Throws unless the path still names the verified directory. */
	verify(): void {
		assertSameDir(this.dir, this.stats);
	}

	list(limit: number): string[] {
		this.verify();
		return readdirSync(this.dir).sort().slice(0, limit);
	}

	/** Reads a regular file (never through a symlink) up to `maxBytes`. */
	readFile(name: string, maxBytes: number): string {
		this.verify();
		const fd = openSync(join(this.dir, name), constants.O_RDONLY | O_NOFOLLOW);
		try {
			const stats = fstatSync(fd);
			if (!stats.isFile()) throw new Error('not a regular file');
			if (stats.size > maxBytes) throw new Error('too large');
			const buffer = Buffer.alloc(stats.size);
			let offset = 0;
			while (offset < stats.size) {
				const read = readSync(fd, buffer, offset, stats.size - offset, offset);
				if (read === 0) break;
				offset += read;
			}
			this.verify();
			return buffer.subarray(0, offset).toString('utf8');
		} finally {
			closeSync(fd);
		}
	}

	/** lstat of an entry (no symlink following). */
	entryStats(name: string): Stats {
		this.verify();
		return lstatSync(join(this.dir, name));
	}

	close(): void {
		closeSync(this.fd);
	}
}
