import type { DB } from '@ottocode/database';
import { messages, subagents } from '@ottocode/database/schema';
import { and, eq, lt } from 'drizzle-orm';
import { logger } from '@ottocode/sdk';

const INTERRUPTED_MESSAGE =
	'The Otto daemon stopped before this run completed.';
const INTERRUPTED_SUBAGENT =
	'Sub-agent was interrupted because the Otto daemon stopped. Retry it to continue.';

export interface InterruptedRunRecoveryResult {
	messages: number;
	subagents: number;
}

/** Marks persisted work owned by an earlier daemon process as interrupted. */
export function recoverInterruptedRuns(
	db: DB,
	daemonStartedAt: number,
): InterruptedRunRecoveryResult {
	const interruptedAt = Date.now();
	const interruptedMessages = and(
		eq(messages.role, 'assistant'),
		eq(messages.status, 'pending'),
		lt(messages.createdAt, daemonStartedAt),
	);
	const interruptedSubagents = and(
		eq(subagents.status, 'running'),
		lt(subagents.createdAt, daemonStartedAt),
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
