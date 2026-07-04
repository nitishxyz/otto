/**
 * Non-blocking write-behind queue for streamed message-part content.
 *
 * queuePartContentWrite() is synchronous and cheap: it batches the latest
 * content per part for one event-loop tick, then hands the batch to a worker
 * thread that owns its own SQLite connection. The daemon's event loop never
 * waits on SQLite for streaming writes.
 *
 * Durability: flushPartContentWrites() is a barrier that resolves once every
 * queued write is on disk. Runner step-finish/abort/error handlers and daemon
 * shutdown await it, so completed steps are always fully persisted; a hard
 * crash can only lose the final in-flight tick (~ms) of the current step.
 *
 * Fallback: if the worker cannot be spawned (or dies), writes run in-process
 * with the same per-tick coalescing - still batched, just on the main thread.
 * Databases without a known file path (in-memory/test fakes) always use the
 * fallback path.
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

/**
 * Worker source, embedded as a string and materialized to a temp file at
 * runtime. `new Worker(new URL('./file.ts', import.meta.url))` does NOT work
 * in `bun build --compile` binaries (ModuleNotFound: the worker module is not
 * bundled into $bunfs), so the daemon binary silently lost streamed content
 * updates. A temp-file worker works identically in dev and compiled builds.
 *
 * The worker owns its own SQLite connections (WAL: one writer + readers
 * across connections) and coalesces bursts: only the LATEST content per part
 * is written per drain, so a backlog of N deltas costs one UPDATE.
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
  for (const write of writes) {
    try {
      getConnection(write.dbPath)
        .query('UPDATE message_parts SET content = ?1 WHERE id = ?2')
        .run(write.content, write.partId);
    } catch (error) {
      postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'write') {
    pending.set(message.dbPath + '\\u0000' + message.partId, message);
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

interface PendingWrite {
	db: DB;
	dbPath: string | undefined;
	partId: string;
	content: string;
}

const pendingBatch = new Map<string, PendingWrite>();
let sendScheduled = false;

let worker: Worker | null = null;
let workerFailed = false;
let flushSeq = 0;
const flushWaiters = new Map<
	number,
	{ resolve: () => void; timer: ReturnType<typeof setTimeout> }
>();
let fallbackDrain: Promise<void> = Promise.resolve();

function settleFlushWaiter(id: number): void {
	const waiter = flushWaiters.get(id);
	if (!waiter) return;
	flushWaiters.delete(id);
	clearTimeout(waiter.timer);
	waiter.resolve();
}

function failWorker(reason: unknown): void {
	if (workerFailed) return;
	workerFailed = true;
	logger.error(
		'[persist] part-content worker failed; falling back to in-process writes',
		reason instanceof Error ? reason.message : reason,
	);
	for (const id of [...flushWaiters.keys()]) settleFlushWaiter(id);
	try {
		worker?.terminate();
	} catch {}
	worker = null;
}

function ensureWorker(): Worker | null {
	if (workerFailed) return null;
	if (worker) return worker;
	try {
		worker = new Worker(pathToFileURL(materializeWorkerScript()).href);
		worker.onmessage = (event: MessageEvent) => {
			const message = event.data as
				| { type: 'flushed'; id: number }
				| { type: 'error'; message: string };
			if (message.type === 'flushed') {
				settleFlushWaiter(message.id);
			} else if (message.type === 'error') {
				logger.error('[persist] worker write failed', message.message);
			}
		};
		worker.onerror = (event) => {
			failWorker(event);
		};
	} catch (error) {
		failWorker(error);
	}
	return worker;
}

function sendBatch(): void {
	sendScheduled = false;
	if (pendingBatch.size === 0) return;
	const entries = [...pendingBatch.values()];
	pendingBatch.clear();

	const activeWorker = ensureWorker();
	const fallbackEntries: PendingWrite[] = [];
	for (const entry of entries) {
		if (activeWorker && entry.dbPath) {
			try {
				activeWorker.postMessage({
					type: 'write',
					dbPath: entry.dbPath,
					partId: entry.partId,
					content: entry.content,
				});
				continue;
			} catch (error) {
				failWorker(error);
			}
		}
		fallbackEntries.push(entry);
	}

	if (fallbackEntries.length > 0) {
		fallbackDrain = fallbackDrain.then(async () => {
			for (const entry of fallbackEntries) {
				try {
					await entry.db
						.update(messageParts)
						.set({ content: entry.content })
						.where(eq(messageParts.id, entry.partId));
				} catch (error) {
					logger.error(
						'[persist] fallback write failed',
						error instanceof Error ? error.message : error,
					);
				}
			}
		});
	}
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
	pendingBatch.set(`${dbPath ?? 'mem'}\u0000${partId}`, {
		db,
		dbPath,
		partId,
		content,
	});
	if (!sendScheduled) {
		sendScheduled = true;
		setTimeout(sendBatch, 0);
	}
}

/**
 * Barrier: resolves once every queued part-content write has been persisted.
 * Await at step finish, abort, error, and shutdown.
 */
export async function flushPartContentWrites(): Promise<void> {
	if (pendingBatch.size > 0) sendBatch();
	const waits: Promise<void>[] = [fallbackDrain];
	if (worker && !workerFailed) {
		const activeWorker = worker;
		const id = ++flushSeq;
		waits.push(
			new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					if (flushWaiters.delete(id)) {
						logger.warn('[persist] flush ack timed out');
						resolve();
					}
				}, FLUSH_ACK_TIMEOUT_MS);
				flushWaiters.set(id, { resolve, timer });
				try {
					activeWorker.postMessage({ type: 'flush', id });
				} catch (error) {
					settleFlushWaiter(id);
					failWorker(error);
				}
			}),
		);
	}
	await Promise.all(waits);
}

/**
 * Flush pending writes and stop the worker. Called on daemon shutdown.
 */
export async function shutdownPartContentWriter(): Promise<void> {
	await flushPartContentWrites();
	try {
		worker?.terminate();
	} catch {}
	worker = null;
}
