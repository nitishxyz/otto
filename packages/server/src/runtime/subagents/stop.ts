import { and, eq } from 'drizzle-orm';
import { subagents } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { abortSession, getQueueState } from '../session/queue.ts';
import { getSessionById } from '../session/manager.ts';
import { attemptOf, terminateSubagentAttempt } from './transitions.ts';
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

	const childSession = await getSessionById({
		db,
		sessionId: record.childSessionId,
	});
	const projectRoot = input.projectRoot ?? childSession?.projectPath;
	const queueState = projectRoot
		? getQueueState(record.childSessionId, projectRoot)
		: undefined;
	const wasRunning = queueState?.isRunning === true;
	const clearedQueuedMessages = queueState?.queuedMessages.length ?? 0;
	const stopped = terminateSubagentAttempt(db, attemptOf(record), {
		status: 'cancelled',
		summary: 'Stopped by the parent agent.',
		reported: true,
	});
	if (!stopped) {
		const [current] = await db
			.select({ status: subagents.status })
			.from(subagents)
			.where(eq(subagents.id, record.id))
			.limit(1);
		return {
			ok: false,
			error:
				current && current.status !== 'running'
					? `Sub-agent is already ${current.status} and cannot be stopped.`
					: 'Sub-agent changed concurrently; check its status and try again.',
		};
	}

	if (projectRoot)
		abortSession(
			record.childSessionId,
			true,
			{
				type: 'subagent-stopped-by-parent',
			},
			projectRoot,
		);

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
