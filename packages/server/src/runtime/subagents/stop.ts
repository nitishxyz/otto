import { and, eq } from 'drizzle-orm';
import { subagents } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { abortSession, getQueueState } from '../session/queue.ts';
import type { StopSubagentInput, StopSubagentResult } from './types.ts';

/** Stops one running sub-agent owned by the requesting parent session. */
export async function stopSubagent(
	input: StopSubagentInput,
): Promise<StopSubagentResult> {
	const { db, parentSessionId, subagentId } = input;
	const rows = await db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.id, subagentId),
				eq(subagents.parentSessionId, parentSessionId),
			),
		)
		.limit(1);
	const record = rows[0];
	if (!record) {
		return {
			ok: false,
			error: `No sub-agent with id "${subagentId}" for this session. Use subagent action=list to find ids.`,
		};
	}
	if (record.status !== 'running') {
		return {
			ok: false,
			error: `Sub-agent is already ${record.status} and cannot be stopped.`,
		};
	}

	const queueState = getQueueState(record.childSessionId);
	const wasRunning = queueState?.isRunning === true;
	const clearedQueuedMessages = queueState?.queuedMessages.length ?? 0;
	const now = Date.now();
	await db
		.update(subagents)
		.set({
			status: 'cancelled',
			summary: 'Stopped by the parent agent.',
			reported: true,
			updatedAt: now,
		})
		.where(eq(subagents.id, record.id));

	abortSession(record.childSessionId, true, {
		type: 'subagent-stopped-by-parent',
	});

	logger.info('[subagent] stopped by parent', {
		subagentId: record.id,
		parentSessionId,
		childSessionId: record.childSessionId,
		wasRunning,
		clearedQueuedMessages,
	});

	return {
		ok: true,
		subagentId: record.id,
		childSessionId: record.childSessionId,
		agent: record.agent,
		wasRunning,
		clearedQueuedMessages,
	};
}
