import type { DB } from '@ottocode/database';
import { messages, subagents } from '@ottocode/database/schema';
import { and, eq, lt } from 'drizzle-orm';
import { logger } from '@ottocode/sdk';
import {
	recoverToolFinalizations,
	type ToolFinalizationRecoveryResult,
} from '../persistence/tool-finalization-recovery.ts';
import { inspectLiveRunOwners } from '../persistence/tool-finalization-owners.ts';

const INTERRUPTED_MESSAGE =
	'The Otto daemon stopped before this run completed.';
const INTERRUPTED_SUBAGENT =
	'Sub-agent was interrupted because the Otto daemon stopped. Retry it to continue.';

export interface InterruptedRunRecoveryResult {
	messages: number;
	subagents: number;
}

/**
 * Replays journaled tool results left by processes that are no longer
 * running (any mode: daemon, standalone or embedded). Records owned by a
 * live process are left alone. Never re-executes tools; never throws.
 */
export function recoverJournaledToolResults(
	db: DB,
): ToolFinalizationRecoveryResult | undefined {
	try {
		return recoverToolFinalizations(db);
	} catch (error) {
		logger.warn('[projects] tool finalization recovery failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

/**
 * Marks persisted work owned by an earlier, no longer running process as
 * interrupted, after replaying journaled tool results of dead owners (never
 * re-executing tools; interrupted calls become explicit unknown-outcome
 * results).
 *
 * Live-owner protection: rows newer than the oldest live foreign run-owner
 * lease (another daemon, standalone or embedded process on the same DB)
 * are left untouched. If the lease directory cannot be trusted, nothing is
 * marked.
 */
export function recoverInterruptedRuns(
	db: DB,
	daemonStartedAt: number,
): InterruptedRunRecoveryResult {
	recoverJournaledToolResults(db);
	const owners = inspectLiveRunOwners(db);
	if (!owners.safe) {
		logger.warn('[projects] skipped interrupted-run recovery', {
			reason: owners.reason,
		});
		return { messages: 0, subagents: 0 };
	}
	const cutoff = Math.min(
		daemonStartedAt,
		owners.oldestForeignStartedAt ?? Number.POSITIVE_INFINITY,
	);
	const interruptedAt = Date.now();
	const interruptedMessages = and(
		eq(messages.role, 'assistant'),
		eq(messages.status, 'pending'),
		lt(messages.createdAt, cutoff),
	);
	const interruptedSubagents = and(
		eq(subagents.status, 'running'),
		lt(subagents.updatedAt, cutoff),
	);
	const result = db.transaction((tx) => {
		const recoveredMessages = tx
			.select({ id: messages.id })
			.from(messages)
			.where(interruptedMessages)
			.all();
		const recoveredSubagents = tx
			.select({ id: subagents.id })
			.from(subagents)
			.where(interruptedSubagents)
			.all();

		tx.update(messages)
			.set({
				status: 'error',
				completedAt: interruptedAt,
				error: INTERRUPTED_MESSAGE,
				errorType: 'daemon_interrupted',
				errorDetails: JSON.stringify({
					interruptedAt,
					daemonStartedAt,
				}),
				finishReason: 'error',
				isAborted: false,
			})
			.where(interruptedMessages)
			.run();

		tx.update(subagents)
			.set({
				status: 'failed',
				summary: INTERRUPTED_SUBAGENT,
				reported: false,
				deliveryState: 'pending',
				deliveryKey: null,
				finishedMessageId: null,
				updatedAt: interruptedAt,
			})
			.where(interruptedSubagents)
			.run();

		return {
			messages: recoveredMessages.length,
			subagents: recoveredSubagents.length,
		};
	});

	if (result.messages || result.subagents) {
		logger.warn('[projects] recovered interrupted daemon work', result);
	}
	return result;
}
