/**
 * Non-blocking write-behind queue for streamed message-part content.
 *
 * queuePartContentWrite() is synchronous and cheap: it batches the latest
 * content per part for one event-loop tick, then hands the batch to a worker
 * thread that owns its own SQLite connection. The daemon's event loop never
 * waits on SQLite for streaming writes.
 *
 * Durability contract:
 * - Every queued write gets a monotonically increasing sequence number. The
 *   latest write per part stays tracked as "unacknowledged" until the worker
 *   (or the in-process fallback) confirms that exact sequence committed.
 * - If the worker reports a failed write, dies, or does not acknowledge a
 *   flush in time, every unacknowledged write is replayed in-process.
 * - flushPartContentWrites() resolves only when every write queued before the
 *   call is committed, either itself or through a newer write for the same
 *   part that superseded it. A superseded write is never counted as covered
 *   until its superseding write commits.
 * - Every barrier open when a covered write fails rejects with
 *   PartContentPersistenceError. A failure with no open barrier is reported
 *   once, by the next barrier. Failed writes are then dropped, so later
 *   barriers are not poisoned.
 *
 * Databases without a known file path (in-memory/test fakes) always use the
 * in-process path.
 */
import { getDbFilePath, type DB } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@ottocode/sdk';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const FLUSH_ACK_TIMEOUT_MS = 5000;
/** Send/flush/drain rounds a barrier runs before replaying in-process. */
const MAX_BARRIER_ROUNDS = 5;

/**
 * Worker source, embedded as a string and materialized to a temp file at
 * runtime. `new Worker(new URL('./file.ts', import.meta.url))` does NOT work
 * in `bun build --compile` binaries (ModuleNotFound: the worker module is not
 * bundled into $bunfs), so the daemon binary silently lost streamed content
 * updates. A temp-file worker works identically in dev and compiled builds.
 *
 * The worker owns its own SQLite connections (WAL: one writer + readers
 * across connections) and coalesces bursts: only the LATEST content per part
 * is written per drain, so a backlog of N deltas costs one UPDATE. Each write
 * is acknowledged (or reported failed) by sequence after it commits.
 */
const WORKER_SOURCE = `
import { Database } from 'bun:sqlite';

const connections = new Map();
const pending = new Map();
let drainScheduled = false;

function getConnection(dbPath) {
  let db = connections.get(dbPath);
  if (!db) {
    db = new Database(dbPath, { readwrite: true });
    db.exec('PRAGMA busy_timeout = 5000');
    connections.set(dbPath, db);
  }
  return db;
}

function drain() {
  drainScheduled = false;
  if (pending.size === 0) return;
  const writes = [...pending.values()];
  pending.clear();
  const acked = [];
  for (const write of writes) {
    try {
      getConnection(write.dbPath)
        .query('UPDATE message_parts SET content = ?1 WHERE id = ?2')
        .run(write.content, write.partId);
      acked.push({ key: write.key, seq: write.seq });
    } catch (error) {
      postMessage({
        type: 'failed',
        key: write.key,
        seq: write.seq,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (acked.length > 0) postMessage({ type: 'acked', writes: acked });
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'write') {
    pending.set(message.key, message);
    if (!drainScheduled) {
      drainScheduled = true;
      setTimeout(drain, 0);
    }
    return;
  }
  if (message.type === 'flush') {
    drain();
    postMessage({ type: 'flushed', id: message.id });
  }
};
`;

function materializeWorkerScript(): string {
	const scriptPath = join(
		tmpdir(),
		`otto-part-content-worker-${process.pid}.mjs`,
	);
	writeFileSync(scriptPath, WORKER_SOURCE);
	return scriptPath;
}

/** Raised by flush barriers when queued part content could not be committed. */
export class PartContentPersistenceError extends Error {
	readonly partIds: string[];

	constructor(failures: Array<{ partId: string; error: string }>) {
		super(
			`Failed to persist streamed content for ${failures.length} message part(s): ${failures
				.map((failure) => `${failure.partId} (${failure.error})`)
				.join('; ')}`,
		);
		this.name = 'PartContentPersistenceError';
		this.partIds = failures.map((failure) => failure.partId);
	}
}

interface TrackedWrite {
	key: string;
	seq: number;
	db: DB;
	dbPath: string | undefined;
	partId: string;
	content: string;
}

type WorkerMessage =
	| { type: 'flushed'; id: number }
	| { type: 'acked'; writes: Array<{ key: string; seq: number }> }
	| { type: 'failed'; key: string; seq: number; message: string };

let writeSeq = 0;
/** Latest unacknowledged write per part. */
const unacked = new Map<string, TrackedWrite>();
/** Keys whose latest write has not been dispatched yet. */
const toSend = new Set<string>();
type WriteFailure = { partId: string; seq: number; error: string };
/** Failures no open barrier covered; reported once by the next barrier. */
const orphanFailures = new Map<string, WriteFailure>();

interface Barrier {
	/** Key -> seq that must be committed (or superseded by a commit). */
	pending: Map<string, number>;
	failures: Map<string, WriteFailure>;
}
const openBarriers = new Set<Barrier>();
let sendScheduled = false;

let worker: Worker | null = null;
let workerFailed = false;
let terminatingWorker = false;
let flushSeq = 0;
const flushWaiters = new Map<
	number,
	{ resolve: () => void; timer: ReturnType<typeof setTimeout> }
>();
let fallbackDrain: Promise<void> = Promise.resolve();

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function acknowledge(key: string, seq: number): void {
	const current = unacked.get(key);
	if (current && current.seq === seq) unacked.delete(key);
	const orphan = orphanFailures.get(key);
	if (orphan && orphan.seq <= seq) orphanFailures.delete(key);
	for (const barrier of openBarriers) {
		const required = barrier.pending.get(key);
		if (required !== undefined && seq >= required) {
			barrier.pending.delete(key);
		}
		const failure = barrier.failures.get(key);
		// Newer content committed: the earlier failure is no longer data loss.
		if (failure && failure.seq < seq) barrier.failures.delete(key);
	}
}

function recordFailure(write: TrackedWrite, error: string): void {
	const failure: WriteFailure = { partId: write.partId, seq: write.seq, error };
	let claimed = false;
	for (const barrier of openBarriers) {
		const required = barrier.pending.get(write.key);
		if (required === undefined || write.seq < required) continue;
		barrier.pending.delete(write.key);
		barrier.failures.set(write.key, failure);
		claimed = true;
	}
	if (!claimed) orphanFailures.set(write.key, failure);
}

function settleFlushWaiter(id: number): void {
	const waiter = flushWaiters.get(id);
	if (!waiter) return;
	flushWaiters.delete(id);
	clearTimeout(waiter.timer);
	waiter.resolve();
}

function runInProcess(writes: TrackedWrite[]): void {
	if (writes.length === 0) return;
	fallbackDrain = fallbackDrain.then(async () => {
		for (const write of writes) {
			// A newer write for the same part supersedes this one.
			if (unacked.get(write.key)?.seq !== write.seq) continue;
			try {
				await write.db
					.update(messageParts)
					.set({ content: write.content })
					.where(eq(messageParts.id, write.partId));
				acknowledge(write.key, write.seq);
			} catch (error) {
				const message = errorMessage(error);
				logger.error('[persist] in-process part write failed', message);
				if (unacked.get(write.key)?.seq === write.seq) {
					unacked.delete(write.key);
					recordFailure(write, message);
				}
			}
		}
	});
}

/** Unacknowledged writes already handed to the worker (not awaiting dispatch). */
function inFlightWorkerWrites(): TrackedWrite[] {
	return [...unacked.values()].filter(
		(write) => write.dbPath && !toSend.has(write.key),
	);
}

function failWorker(reason: unknown): void {
	if (workerFailed) return;
	workerFailed = true;
	logger.error(
		'[persist] part-content worker failed; replaying unacknowledged writes in-process',
		errorMessage(reason),
	);
	const active = worker;
	worker = null;
	terminatingWorker = true;
	try {
		active?.terminate();
	} catch {}
	terminatingWorker = false;
	runInProcess(inFlightWorkerWrites());
	for (const id of [...flushWaiters.keys()]) settleFlushWaiter(id);
}

function handleWorkerMessage(message: WorkerMessage): void {
	if (message.type === 'flushed') {
		settleFlushWaiter(message.id);
		return;
	}
	if (message.type === 'acked') {
		for (const write of message.writes) acknowledge(write.key, write.seq);
		return;
	}
	if (message.type === 'failed') {
		logger.error('[persist] worker write failed; retrying', message.message);
		const write = unacked.get(message.key);
		if (write && write.seq === message.seq) runInProcess([write]);
	}
}

function ensureWorker(): Worker | null {
	if (workerFailed) return null;
	if (worker) return worker;
	try {
		const created = new Worker(pathToFileURL(materializeWorkerScript()).href);
		created.onmessage = (event: MessageEvent) => {
			handleWorkerMessage(event.data as WorkerMessage);
		};
		created.onerror = (event) => {
			failWorker(event instanceof ErrorEvent ? event.message : event);
		};
		created.addEventListener('close', () => {
			if (worker === created && !terminatingWorker) {
				failWorker(new Error('part-content worker exited'));
			}
		});
		worker = created;
	} catch (error) {
		failWorker(error);
	}
	return worker;
}

function sendBatch(): void {
	sendScheduled = false;
	if (toSend.size === 0) return;
	const keys = [...toSend];
	toSend.clear();

	const activeWorker = ensureWorker();
	const inProcess: TrackedWrite[] = [];
	for (const key of keys) {
		const write = unacked.get(key);
		if (!write) continue;
		if (activeWorker && write.dbPath) {
			try {
				activeWorker.postMessage({
					type: 'write',
					key: write.key,
					seq: write.seq,
					dbPath: write.dbPath,
					partId: write.partId,
					content: write.content,
				});
				continue;
			} catch (error) {
				failWorker(error);
			}
		}
		inProcess.push(write);
	}
	runInProcess(inProcess);
}

/**
 * Queue the latest content for a message part. Synchronous and non-blocking;
 * repeated calls for the same part within a tick coalesce to one write.
 */
export function queuePartContentWrite(
	db: DB,
	partId: string,
	content: string,
): void {
	const dbPath = getDbFilePath(db);
	const key = `${dbPath ?? 'mem'}\u0000${partId}`;
	unacked.set(key, {
		key,
		seq: ++writeSeq,
		db,
		dbPath,
		partId,
		content,
	});
	toSend.add(key);
	if (!sendScheduled) {
		sendScheduled = true;
		setTimeout(sendBatch, 0);
	}
}

async function awaitWorkerFlush(timeoutMs: number): Promise<void> {
	const activeWorker = worker;
	if (!activeWorker || workerFailed) return;
	const id = ++flushSeq;
	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			if (!flushWaiters.has(id)) return;
			flushWaiters.delete(id);
			resolve();
			failWorker(new Error('flush acknowledgement timed out'));
		}, timeoutMs);
		flushWaiters.set(id, { resolve, timer });
		try {
			activeWorker.postMessage({ type: 'flush', id });
		} catch (error) {
			failWorker(error);
		}
	});
}

async function awaitInProcessDrain(): Promise<void> {
	let observed: Promise<void> | undefined;
	while (observed !== fallbackDrain) {
		observed = fallbackDrain;
		await observed;
	}
}

/**
 * Barrier: resolves once every part-content write queued before the call has
 * been committed. Rejects with PartContentPersistenceError if any of those
 * writes could not be committed after replay. Await at step finish, abort,
 * error, and shutdown.
 */
export async function flushPartContentWrites(options?: {
	timeoutMs?: number;
}): Promise<void> {
	const barrier: Barrier = {
		pending: new Map(
			[...unacked.values()].map((write) => [write.key, write.seq]),
		),
		failures: new Map(orphanFailures),
	};
	orphanFailures.clear();
	openBarriers.add(barrier);
	try {
		const timeoutMs = options?.timeoutMs ?? FLUSH_ACK_TIMEOUT_MS;
		// Each round dispatches the current (possibly superseding) write of
		// every covered part and waits for the worker and in-process drains.
		for (
			let round = 0;
			round < MAX_BARRIER_ROUNDS && barrier.pending.size > 0;
			round++
		) {
			if (toSend.size > 0) sendBatch();
			await awaitWorkerFlush(timeoutMs);
			await awaitInProcessDrain();
		}

		// Still uncommitted: the worker dropped it without reporting, or newer
		// writes kept superseding it. Replay the current write in-process.
		if (barrier.pending.size > 0) {
			const replay: TrackedWrite[] = [];
			for (const key of barrier.pending.keys()) {
				const write = unacked.get(key);
				if (!write) continue;
				toSend.delete(key);
				replay.push(write);
			}
			runInProcess(replay);
			await awaitInProcessDrain();
		}

		const reported = [...barrier.failures.values()].map((failure) => ({
			partId: failure.partId,
			error: failure.error,
		}));
		for (const [key, seq] of barrier.pending) {
			const write = unacked.get(key);
			if (write && write.seq <= seq) unacked.delete(key);
			reported.push({
				partId: write?.partId ?? key.slice(key.indexOf('\u0000') + 1),
				error: 'write was not acknowledged',
			});
		}
		if (reported.length > 0) throw new PartContentPersistenceError(reported);
	} finally {
		openBarriers.delete(barrier);
	}
}

/**
 * Flush pending writes and stop the worker. Called on daemon shutdown.
 * Rejects like flushPartContentWrites(), after the worker is stopped.
 */
export async function shutdownPartContentWriter(): Promise<void> {
	try {
		await flushPartContentWrites();
	} finally {
		const active = worker;
		worker = null;
		terminatingWorker = true;
		try {
			active?.terminate();
		} catch {}
		terminatingWorker = false;
	}
}

/** Test-only hooks for simulating worker failure. */
export const partContentWriterTesting = {
	/** Kill the worker without acknowledging in-flight writes. */
	crashWorker(): void {
		failWorker(new Error('simulated worker crash'));
	},
	/** Allow a fresh worker to be spawned after a simulated crash. */
	reset(): void {
		workerFailed = false;
	},
	unacknowledgedCount(): number {
		return unacked.size;
	},
};
