import { and, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { abortSession } from '../session/queue.ts';
import { getSessionById } from '../session/manager.ts';
import { attemptOf, terminateSubagentAttempt } from './transitions.ts';

/** Aborts all running sub-agent child sessions for a parent session. */
export async function abortChildSubagents(
	db: DB,
	parentSessionId: string,
	projectRoot?: string,
): Promise<void> {
	const running = await db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.parentSessionId, parentSessionId),
				eq(subagents.status, 'running'),
			),
		);
	if (!running.length) return;
	for (const record of running) {
		const childSession = await getSessionById({
			db,
			sessionId: record.childSessionId,
		});
		const scope = projectRoot ?? childSession?.projectPath;
		const cancelled = terminateSubagentAttempt(db, attemptOf(record), {
			status: 'cancelled',
			summary: 'Cancelled because the parent session was aborted.',
			reported: false,
		});
		if (cancelled && scope)
			abortSession(
				record.childSessionId,
				true,
				{
					type: 'parent-session-aborted',
				},
				scope,
			);
	}
	logger.info('[subagent] cascaded abort to children', {
		parentSessionId,
		count: running.length,
	});
}
