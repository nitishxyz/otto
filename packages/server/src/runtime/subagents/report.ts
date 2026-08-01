import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import { logger, type OttoConfig } from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import { getSessionById } from '../session/manager.ts';
import { getRunnerState } from '../session/queue.ts';
import { dispatchSubagentMessage } from './dispatch.ts';
import { buildSubagentResultsPrompt } from './prompt.ts';

/** Atomically claims an unchanged terminal result for parent delivery. */
export function claimFinishedSubagentForReport(
	db: DB,
	record: typeof subagents.$inferSelect,
): boolean {
	if (record.status === 'running' || record.reported) return false;
	const updatedAt = Math.max(Date.now(), record.updatedAt + 1);
	const claimed = db
		.update(subagents)
		.set({ reported: true, updatedAt })
		.where(
			and(
				eq(subagents.id, record.id),
				eq(subagents.reported, false),
				eq(subagents.status, record.status),
				eq(subagents.updatedAt, record.updatedAt),
			),
		)
		.returning({ updatedAt: subagents.updatedAt })
		.get();
	return claimed?.updatedAt === updatedAt;
}

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

	const claimed: typeof finished = [];
	for (const record of finished) {
		if (claimFinishedSubagentForReport(db, record)) claimed.push(record);
	}
	if (!claimed.length) return false;

	publish({
		type: 'session.updated',
		sessionId: parentSessionId,
		projectRoot: cfg.projectRoot,
		payload: {
			id: parentSessionId,
			subagentsFinished: claimed.map((record) => ({
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
		content: buildSubagentResultsPrompt(claimed),
	});

	logger.info('[subagent] reported results to parent', {
		parentSessionId,
		count: claimed.length,
	});
	return true;
}
