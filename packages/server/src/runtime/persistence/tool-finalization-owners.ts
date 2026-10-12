/**
 * Run-owner leases: one small file per live process that may own runs or
 * tool calls in a project database, stored in a private directory next to
 * the DB (`run-owners/<ownerId>.json`). Recovery uses them so that opening
 * the same project from a second process (daemon, standalone or embedded)
 * never marks another live process's pending messages, running sub-agents
 * or journal intents as interrupted.
 *
 * Contract: a lease records the owner's process start time. Every row a
 * process creates or touches has a timestamp >= that start, so rows older
 * than the oldest live foreign lease cannot belong to any live owner.
 * Liveness is a single-host pid probe (see isToolJournalOwnerAlive).
 */
import { unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { getDbFilePath } from '@ottocode/database';
import {
	PrivateDirReader,
	removePrivateFile,
	writePrivateFileAtomic,
} from './tool-finalization-fs.ts';
import {
	isToolJournalOwnerAlive,
	TOOL_JOURNAL_OWNER_ID,
	type ToolJournalOwner,
} from './tool-finalization-journal.ts';

export const RUN_OWNERS_DIRNAME = 'run-owners';
const MAX_LEASE_BYTES = 4096;
const MAX_LEASES = 1024;

/** Conservative process start: never later than any row this process wrote. */
export const RUN_OWNER_STARTED_AT = Math.floor(
	Math.min(performance.timeOrigin, Date.now()),
);

const leaseSchema = z
	.object({
		v: z.literal(1),
		owner: z.string().uuid(),
		pid: z.number().int(),
		startedAt: z.number().finite(),
	})
	.strict();

export type RunOwnerLease = z.infer<typeof leaseSchema>;

export function resolveRunOwnersDir(db: unknown): string | undefined {
	const dbPath = getDbFilePath(db);
	if (!dbPath || !isAbsolute(dbPath)) return undefined;
	return join(dirname(dbPath), RUN_OWNERS_DIRNAME);
}

const registered = new Map<string, Promise<void>>();

/**
 * Publishes this process's lease for the DB's project state (idempotent).
 * Must be called before the process creates runs; the project manager and
 * the tool adapter both call it. Throws when the lease cannot be written.
 */
export async function registerRunOwner(db: unknown): Promise<void> {
	const dir = resolveRunOwnersDir(db);
	if (!dir) return;
	const existing = registered.get(dir);
	if (existing) {
		try {
			await existing;
			if (leaseStillPresent(dir)) return;
		} catch {}
	}
	const lease: RunOwnerLease = {
		v: 1,
		owner: TOOL_JOURNAL_OWNER_ID,
		pid: process.pid,
		startedAt: RUN_OWNER_STARTED_AT,
	};
	const pending = writePrivateFileAtomic(
		dir,
		`${TOOL_JOURNAL_OWNER_ID}.json`,
		JSON.stringify(lease),
		`${TOOL_JOURNAL_OWNER_ID}.${process.pid}`,
	);
	registered.set(dir, pending);
	try {
		await pending;
	} catch (error) {
		registered.delete(dir);
		throw error;
	}
}

function leaseStillPresent(dir: string): boolean {
	try {
		const reader = PrivateDirReader.open(dir);
		if (!reader) return false;
		try {
			return reader.entryStats(`${TOOL_JOURNAL_OWNER_ID}.json`).isFile();
		} finally {
			reader.close();
		}
	} catch {
		return false;
	}
}

/** Removes this process's lease (best effort, e.g. on clean shutdown). */
export async function releaseRunOwner(db: unknown): Promise<void> {
	const dir = resolveRunOwnersDir(db);
	if (!dir) return;
	registered.delete(dir);
	await removePrivateFile(dir, `${TOOL_JOURNAL_OWNER_ID}.json`);
}

export type LiveRunOwners =
	| { safe: true; oldestForeignStartedAt: number | undefined; live: number }
	| { safe: false; reason: string };

const LEASE_TEMP_PATTERN = /^([0-9a-f-]{36})\.(\d+)\.[0-9a-f-]{36}\.tmp$/;

/**
 * Inspects leases, pruning only provably dead owners. Fails closed:
 * `safe: false` (callers must not mark any run as interrupted) when the
 * directory cannot be trusted, or when any entry's owner cannot be
 * established - malformed/unreadable leases, foreign files, temp files of
 * live writers, or more entries than can be inspected. Such entries are
 * left in place and reported; age alone never makes an owner dead. An
 * operator removes them after confirming no Otto process uses the project.
 */
export function inspectLiveRunOwners(
	db: unknown,
	options: {
		isOwnerAlive?: (owner: ToolJournalOwner) => boolean;
	} = {},
): LiveRunOwners {
	const dir = resolveRunOwnersDir(db);
	if (!dir) return { safe: true, oldestForeignStartedAt: undefined, live: 0 };
	const isAlive = options.isOwnerAlive ?? isToolJournalOwnerAlive;
	let reader: PrivateDirReader | undefined;
	try {
		reader = PrivateDirReader.open(dir);
	} catch (error) {
		return {
			safe: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
	if (!reader)
		return { safe: true, oldestForeignStartedAt: undefined, live: 0 };
	try {
		const entries = reader.list(MAX_LEASES + 1);
		if (entries.length > MAX_LEASES) {
			return { safe: false, reason: 'too many run-owner entries' };
		}
		const uncertain: string[] = [];
		let oldest: number | undefined;
		let live = 0;
		for (const entry of entries) {
			const path = join(dir, entry);
			if (!entry.endsWith('.json')) {
				const temp = LEASE_TEMP_PATTERN.exec(entry);
				const owner = temp
					? { owner: String(temp[1]), pid: Number(temp[2]) }
					: undefined;
				if (owner && owner.owner === TOOL_JOURNAL_OWNER_ID) continue;
				if (owner && !isAlive(owner)) {
					reader.verify();
					removeSync(path);
					continue;
				}
				uncertain.push(entry);
				continue;
			}
			let lease: RunOwnerLease;
			try {
				lease = leaseSchema.parse(
					JSON.parse(reader.readFile(entry, MAX_LEASE_BYTES)),
				);
				if (`${lease.owner}.json` !== entry) throw new Error('name mismatch');
			} catch {
				uncertain.push(entry);
				continue;
			}
			if (lease.owner === TOOL_JOURNAL_OWNER_ID) continue;
			if (!isAlive(lease)) {
				reader.verify();
				removeSync(path);
				continue;
			}
			live++;
			oldest =
				oldest === undefined
					? lease.startedAt
					: Math.min(oldest, lease.startedAt);
		}
		if (uncertain.length > 0) {
			return {
				safe: false,
				reason: `unverifiable run-owner entries in ${dir}: ${uncertain
					.slice(0, 10)
					.join(', ')}`,
			};
		}
		return { safe: true, oldestForeignStartedAt: oldest, live };
	} catch (error) {
		return {
			safe: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	} finally {
		reader.close();
	}
}

function removeSync(path: string): void {
	try {
		unlinkSync(path);
	} catch {}
}
