import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import { logger, type OttoConfig } from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import { getSessionById } from '../session/manager.ts';
import { getRunnerState } from '../session/queue.ts';
import { dispatchSubagentMessage } from './dispatch.ts';
import { buildSubagentResultsPrompt } from './prompt.ts';

/**
 * Reports unreported finished sub-agents to their parent session by
 * enqueueing a continuation run. Only runs when the parent is idle.
 */
export async function reportFinishedSubagents(
	db: DB,
	cfg: OttoConfig,
	parentSessionId: string,
): Promise<boolean> {
	const state = getRunnerState(parentSessionId);
	if (state && (state.running || state.queue.length > 0)) return false;

	const unreported = await db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.parentSessionId, parentSessionId),
				eq(subagents.reported, false),
			),
		)
		.orderBy(asc(subagents.createdAt));
	const finished = unreported.filter((record) => record.status !== 'running');
	if (!finished.length) return false;

	const parentSession = await getSessionById({
		db,
		sessionId: parentSessionId,
	});
	if (!parentSession) return false;

	const now = Date.now();
	for (const record of finished) {
		await db
			.update(subagents)
			.set({ reported: true, updatedAt: now })
			.where(eq(subagents.id, record.id));
	}

	publish({
		type: 'session.updated',
		sessionId: parentSessionId,
		projectRoot: cfg.projectRoot,
		payload: {
			id: parentSessionId,
			subagentsFinished: finished.map((record) => ({
				subagentId: record.id,
				childSessionId: record.childSessionId,
				agent: record.agent,
				status: record.status,
			})),
		},
	});

	await dispatchSubagentMessage({
		cfg,
		db,
		session: parentSession,
		agent: parentSession.agent,
		content: buildSubagentResultsPrompt(finished),
	});

	logger.info('[subagent] reported results to parent', {
		parentSessionId,
		count: finished.length,
	});
	return true;
}
