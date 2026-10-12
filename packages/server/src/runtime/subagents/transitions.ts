import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import { MAX_CONCURRENT_PER_PARENT, type SubagentRecord } from './types.ts';
import type { TurnClaim } from '../message/types.ts';

/**
 * Single owner of sub-agent lifecycle transitions.
 *
 * Attempts have an explicit sequence and identity, bound to the accepted
 * assistant message. All writes are compare-and-set
 * against the expected status and attempt, so concurrent stop/finalize/
 * follow-up/retry can never overwrite each other. Capacity (running attempts
 * per parent) and the one-active-attempt-per-child invariant are checked and
 * reserved in the same SQLite transaction as the write.
 */

export type SubagentStatusValue =
	| 'running'
	| 'completed'
	| 'failed'
	| 'cancelled';

export type SubagentAttempt = {
	subagentId: string;
	childSessionId: string;
	attemptSeq: number;
	attemptId: string | null;
};

export type TransitionResult =
	| { ok: true; record: SubagentRecord }
	| { ok: false; error: string; record?: SubagentRecord };

export type StartAttemptResult =
	| { ok: true; record: SubagentRecord; previous: SubagentRecord }
	| { ok: false; error: string; record?: SubagentRecord };

export function nextSubagentVersion(record: { updatedAt: number }): number {
	return Math.max(Date.now(), record.updatedAt + 1);
}

export function attemptOf(record: SubagentRecord): SubagentAttempt {
	return {
		subagentId: record.id,
		childSessionId: record.childSessionId,
		attemptSeq: record.attemptSeq,
		attemptId: record.attemptId,
	};
}

function quotaError(): string {
	return `Too many running sub-agents (max ${MAX_CONCURRENT_PER_PARENT}). Wait for one to finish or use subagent action=list.`;
}

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

function reserveTransaction<T>(
	db: DB,
	run: (tx: Tx) => T,
): T | { ok: false; error: string } {
	try {
		return db.transaction(run);
	} catch (error) {
		let cause: unknown = error;
		while (cause instanceof Error) {
			if (
				/UNIQUE constraint failed: subagents\.child_session_id|subagents_running_child_unique/.test(
					cause.message,
				)
			) {
				return {
					ok: false,
					error: 'Another task is already running in this sub-agent session.',
				};
			}
			cause = cause.cause;
		}
		throw error;
	}
}

function runningCountForParent(tx: Tx | DB, parentSessionId: string): number {
	return tx
		.select({ id: subagents.id })
		.from(subagents)
		.where(
			and(
				eq(subagents.parentSessionId, parentSessionId),
				eq(subagents.status, 'running'),
			),
		)
		.all().length;
}

/**
 * Advisory capacity pre-check (avoids creating child sessions that cannot
 * run). The authoritative reservation happens in reserveSpawnAttempt.
 */
export function checkSpawnCapacity(
	db: DB,
	parentSessionId: string,
): { ok: true } | { ok: false; error: string } {
	return runningCountForParent(db, parentSessionId) >= MAX_CONCURRENT_PER_PARENT
		? { ok: false, error: quotaError() }
		: { ok: true };
}

function activeAttemptForChild(
	tx: Tx,
	childSessionId: string,
	excludeId?: string,
): SubagentRecord | undefined {
	return tx
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.childSessionId, childSessionId),
				eq(subagents.status, 'running'),
				...(excludeId ? [ne(subagents.id, excludeId)] : []),
			),
		)
		.get();
}

/**
 * Creates a new running attempt (spawn). Reserves parent capacity and the
 * child session in one transaction.
 */
export function reserveSpawnAttempt(
	db: DB,
	values: {
		id: string;
		parentSessionId: string;
		childSessionId: string;
		agent: string;
		task: string;
	},
): TransitionResult {
	return reserveTransaction(db, (tx) => {
		if (
			runningCountForParent(tx, values.parentSessionId) >=
			MAX_CONCURRENT_PER_PARENT
		) {
			return { ok: false as const, error: quotaError() };
		}
		if (activeAttemptForChild(tx, values.childSessionId)) {
			return {
				ok: false as const,
				error:
					'Reuse session is still running a task. Wait for it to finish or delegate to a fresh session.',
			};
		}
		const now = Date.now();
		const record = tx
			.insert(subagents)
			.values({
				...values,
				status: 'running',
				attemptSeq: 1,
				attemptId: crypto.randomUUID(),
				deliveryState: 'none',
				summary: null,
				reported: false,
				createdAt: now,
				updatedAt: now,
			})
			.returning()
			.get();
		return { ok: true as const, record };
	});
}

/**
 * Starts a new attempt on an existing record (follow-up or retry). Only the
 * newest record for a child session may be restarted; capacity is reserved
 * when the record is not already running.
 */
export function startSubagentAttempt(
	db: DB,
	args: {
		subagentId: string;
		parentSessionId: string;
		allowedFrom: readonly SubagentStatusValue[];
		disallowedMessage?: (status: string) => string;
	},
): StartAttemptResult {
	return reserveTransaction(db, (tx) => {
		const current = tx
			.select()
			.from(subagents)
			.where(
				and(
					eq(subagents.id, args.subagentId),
					eq(subagents.parentSessionId, args.parentSessionId),
				),
			)
			.get();
		if (!current) {
			return {
				ok: false as const,
				error: `No sub-agent with id "${args.subagentId}" for this session. Use subagent action=list to find ids.`,
			};
		}
		if (!args.allowedFrom.includes(current.status as SubagentStatusValue)) {
			return {
				ok: false as const,
				record: current,
				error:
					args.disallowedMessage?.(current.status) ??
					`Sub-agent is ${current.status}.`,
			};
		}
		const newest = tx
			.select({ id: subagents.id })
			.from(subagents)
			.where(eq(subagents.childSessionId, current.childSessionId))
			.orderBy(desc(subagents.createdAt))
			.get();
		if (newest && newest.id !== current.id) {
			return {
				ok: false as const,
				record: current,
				error: `Sub-agent id "${current.id}" was superseded by "${newest.id}" in the same child session. Use the newer id.`,
			};
		}
		if (activeAttemptForChild(tx, current.childSessionId, current.id)) {
			return {
				ok: false as const,
				record: current,
				error: 'Another task is already running in this sub-agent session.',
			};
		}
		if (
			current.status !== 'running' &&
			runningCountForParent(tx, args.parentSessionId) >=
				MAX_CONCURRENT_PER_PARENT
		) {
			return { ok: false as const, record: current, error: quotaError() };
		}
		const updatedAt = nextSubagentVersion(current);
		const record = tx
			.update(subagents)
			.set({
				status: 'running',
				summary: null,
				reported: false,
				updatedAt,
				attemptSeq: current.attemptSeq + 1,
				attemptId: crypto.randomUUID(),
				deliveryState: 'none',
				deliveryKey: null,
				finishedMessageId: null,
			})
			.where(
				and(
					eq(subagents.id, current.id),
					eq(subagents.status, current.status),
					eq(subagents.attemptSeq, current.attemptSeq),
				),
			)
			.returning()
			.get();
		if (!record) {
			return {
				ok: false as const,
				record: current,
				error: 'Sub-agent changed concurrently; try again.',
			};
		}
		return { ok: true as const, record, previous: current };
	});
}

/**
 * Moves one specific running attempt to a terminal status. Returns the new
 * record, or undefined when the attempt is no longer current (stopped,
 * superseded by a follow-up, or already finalized).
 */
export function terminateSubagentAttempt(
	db: DB,
	attempt: SubagentAttempt,
	patch: {
		status: Exclude<SubagentStatusValue, 'running'>;
		summary: string;
		reported: boolean;
		finishedMessageId?: string | null;
	},
): SubagentRecord | undefined {
	const updatedAt = Date.now();
	return db
		.update(subagents)
		.set({
			...patch,
			reported: false,
			deliveryState: 'pending',
			deliveryKey: null,
			finishedMessageId: patch.finishedMessageId ?? null,
			updatedAt,
		})
		.where(
			and(
				eq(subagents.id, attempt.subagentId),
				eq(subagents.status, 'running'),
				eq(subagents.attemptSeq, attempt.attemptSeq),
				attempt.attemptId === null
					? isNull(subagents.attemptId)
					: eq(subagents.attemptId, attempt.attemptId),
			),
		)
		.returning()
		.get();
}

/**
 * Restores a record to a prior terminal state after a failed attempt start
 * (e.g. retry dispatch failed), only if the attempt is still current.
 */
export function revertSubagentAttempt(
	db: DB,
	attempt: SubagentAttempt,
	previous: SubagentRecord,
): SubagentRecord | undefined {
	const updatedAt = Date.now();
	return db
		.update(subagents)
		.set({
			status: previous.status,
			summary: previous.summary,
			reported: previous.reported,
			attemptId: previous.attemptId,
			deliveryState: previous.deliveryState,
			deliveryKey: previous.deliveryKey,
			finishedMessageId: previous.finishedMessageId,
			updatedAt,
		})
		.where(
			and(
				eq(subagents.id, attempt.subagentId),
				eq(subagents.status, 'running'),
				eq(subagents.attemptSeq, attempt.attemptSeq),
				attempt.attemptId === null
					? isNull(subagents.attemptId)
					: eq(subagents.attemptId, attempt.attemptId),
			),
		)
		.returning()
		.get();
}

/** Binds an attempt to its message before the accepted turn can run. */
export function subagentAttemptTurnClaim(attempt: SubagentAttempt): TurnClaim {
	return (tx, ids) => {
		const row = tx
			.update(subagents)
			.set({ attemptId: ids.assistantMessageId })
			.where(
				and(
					eq(subagents.id, attempt.subagentId),
					eq(subagents.status, 'running'),
					eq(subagents.attemptSeq, attempt.attemptSeq),
					attempt.attemptId === null
						? isNull(subagents.attemptId)
						: eq(subagents.attemptId, attempt.attemptId),
				),
			)
			.returning({ id: subagents.id })
			.get();
		if (!row) throw new Error('Sub-agent attempt changed before dispatch.');
	};
}
