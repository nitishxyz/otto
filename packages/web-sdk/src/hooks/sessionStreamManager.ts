import type { QueryClient } from '@tanstack/react-query';
import { getProjectKey } from '../lib/api-client/utils';
import { startSessionStreamEngine } from './sessionStreamEngine';
import { getQueueStateQueryKey, type QueueState } from './useQueueState';

/** How long an idle (not running) background engine is kept attached. */
const BACKGROUND_RETENTION_MS = 5 * 60_000;
/** Cadence of retention sweeps while background engines exist. */
const SWEEP_INTERVAL_MS = 30_000;
/** Cap on idle background engines; oldest are detached first. */
const MAX_IDLE_BACKGROUND_ENGINES = 4;

interface EngineEntry {
	key: string;
	sessionId: string;
	queryClient: QueryClient;
	queueStateQueryKey: readonly unknown[];
	stop: () => void;
	/** Number of mounted useSessionStream subscribers (active viewers). */
	activeRefs: number;
	/** Last time the session was actively viewed (or seen running). */
	lastActiveAt: number;
}

const engines = new Map<string, EngineEntry>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function engineKey(sessionId: string): string {
	return `${getProjectKey()}::${sessionId}`;
}

function isEngineRunning(entry: EngineEntry): boolean {
	const queueState = entry.queryClient.getQueryData<QueueState>(
		entry.queueStateQueryKey,
	);
	return Boolean(queueState?.isRunning);
}

function stopEngine(entry: EngineEntry): void {
	engines.delete(entry.key);
	entry.stop();
	if (engines.size === 0 && sweepTimer !== null) {
		clearInterval(sweepTimer);
		sweepTimer = null;
	}
}

function sweep(): void {
	const now = Date.now();
	const idle: EngineEntry[] = [];
	for (const entry of [...engines.values()]) {
		if (entry.activeRefs > 0) continue;
		if (isEngineRunning(entry)) {
			// Still streaming in the background: keep attached so no chunks are
			// lost, and refresh the retention window for after it finishes.
			entry.lastActiveAt = now;
			continue;
		}
		if (now - entry.lastActiveAt > BACKGROUND_RETENTION_MS) {
			stopEngine(entry);
			continue;
		}
		idle.push(entry);
	}
	if (idle.length > MAX_IDLE_BACKGROUND_ENGINES) {
		idle.sort((a, b) => a.lastActiveAt - b.lastActiveAt);
		for (const entry of idle.slice(
			0,
			idle.length - MAX_IDLE_BACKGROUND_ENGINES,
		)) {
			stopEngine(entry);
		}
	}
	if (engines.size === 0 && sweepTimer !== null) {
		clearInterval(sweepTimer);
		sweepTimer = null;
	}
}

function ensureSweeper(): void {
	if (sweepTimer !== null) return;
	sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
}

/**
 * Attaches the session's stream engine as the actively viewed session.
 *
 * The engine survives release: it stays attached while the session's turn is
 * still running (so streamed chunks keep landing in the query cache during
 * session switches) and for a short retention window afterwards. Returns a
 * release function for the active viewer reference.
 */
export function acquireActiveSessionStream(
	sessionId: string,
	queryClient: QueryClient,
): () => void {
	const key = engineKey(sessionId);
	let entry = engines.get(key);
	if (!entry) {
		const created: EngineEntry = {
			key,
			sessionId,
			queryClient,
			queueStateQueryKey: getQueueStateQueryKey(sessionId),
			stop: () => {},
			activeRefs: 0,
			lastActiveAt: Date.now(),
		};
		created.stop = startSessionStreamEngine({
			sessionId,
			queryClient,
			isActive: () => created.activeRefs > 0,
		});
		engines.set(key, created);
		entry = created;
	}
	entry.activeRefs += 1;
	entry.lastActiveAt = Date.now();
	ensureSweeper();

	let released = false;
	return () => {
		if (released) return;
		released = true;
		entry.activeRefs -= 1;
		entry.lastActiveAt = Date.now();
	};
}
