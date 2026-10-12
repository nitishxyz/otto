import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { sessions, subagents } from '@ottocode/database/schema';
import { logger, type OttoConfig } from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import { getModelLimits } from '../message/compaction.ts';
import { getSessionById } from '../session/manager.ts';
import { getRunnerState } from '../session/queue.ts';
import { dispatchSubagentMessage } from './dispatch.ts';
import {
	buildSubagentCompactionCompletePrompt,
	buildSubagentResultsPrompt,
} from './prompt.ts';
import type { SubagentRecord } from './types.ts';
import {
	claimSubagentResults,
	subagentResultsTurnClaim,
	SubagentResultClaimConflictError,
} from '../message/parent-continuation.ts';

export {
	claimSubagentResults,
	subagentResultsTurnClaim,
	SubagentResultClaimConflictError,
} from '../message/parent-continuation.ts';

/** Queues a parent continuation after a child session compacts successfully. */
export async function reportSubagentCompactionComplete(
	db: DB,
	cfg: OttoConfig,
	childSessionId: string,
): Promise<boolean> {
	const records = await db
		.select()
		.from(subagents)
		.where(eq(subagents.childSessionId, childSessionId))
		.orderBy(desc(subagents.createdAt))
		.limit(1);
	const record = records[0];
	if (!record) return false;

	const parentSession = await getSessionById({
		db,
		sessionId: record.parentSessionId,
	});
	if (!parentSession) return false;

	await dispatchSubagentMessage({
		cfg,
		db,
		session: parentSession,
		agent: parentSession.agent,
		content: buildSubagentCompactionCompletePrompt({
			subagentId: record.id,
			agent: record.agent,
			childSessionId,
		}),
		messageOrigin: 'agent-results',
	});

	logger.info('[subagent] reported compaction to parent', {
		subagentId: record.id,
		parentSessionId: record.parentSessionId,
		childSessionId,
	});
	return true;
}

/** Atomically claims an unchanged terminal result for parent delivery. */
export function claimFinishedSubagentForReport(
	db: DB,
	record: typeof subagents.$inferSelect,
): boolean {
	try {
		db.transaction((tx) =>
			claimSubagentResults(tx, {
				parentSessionId: record.parentSessionId,
				deliveryKey: subagentDeliveryKey([record]),
				claims: [record],
			}),
		);
		return true;
	} catch (error) {
		if (error instanceof SubagentResultClaimConflictError) return false;
		throw error;
	}
}

/**
 * Idempotency key for delivering an exact set of terminal results. It is
 * stored with the atomic claim, not used for transcript-text deduplication.
 */
export function subagentDeliveryKey(
	records: Array<Pick<SubagentRecord, 'id' | 'attemptSeq'>>,
): string {
	const material = records
		.map((record) => `${record.id}@${record.attemptSeq}`)
		.sort()
		.join('\n');
	return `sad_${createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}

/** Claims results atomically with the persisted parent continuation. */
export async function reportFinishedSubagents(
	db: DB,
	cfg: OttoConfig,
	parentSessionId: string,
): Promise<boolean> {
	const state = getRunnerState(parentSessionId, cfg.projectRoot);
	if (state && (state.running || state.queue.length > 0)) return false;
	return deliverFinishedSubagents(db, cfg, parentSessionId);
}

async function deliverFinishedSubagents(
	db: DB,
	cfg: OttoConfig,
	parentSessionId: string,
): Promise<boolean> {
	const unreported = await db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.parentSessionId, parentSessionId),
				eq(subagents.deliveryState, 'pending'),
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

	const deliveryKey = subagentDeliveryKey(finished);

	const contextRows = await db
		.select({
			id: sessions.id,
			tokens: sessions.currentContextTokens,
			provider: sessions.provider,
			model: sessions.model,
		})
		.from(sessions)
		.where(
			inArray(
				sessions.id,
				finished.map((record) => record.childSessionId),
			),
		);
	const contextBySession = new Map(
		contextRows.map((row) => [
			row.id,
			{
				tokens: row.tokens,
				window: getModelLimits(row.provider, row.model)?.context ?? null,
			},
		]),
	);

	try {
		await dispatchSubagentMessage({
			cfg,
			db,
			session: parentSession,
			agent: parentSession.agent,
			content: buildSubagentResultsPrompt(
				finished.map((record) => ({
					...record,
					contextTokens:
						contextBySession.get(record.childSessionId)?.tokens ?? null,
					contextWindowTokens:
						contextBySession.get(record.childSessionId)?.window ?? null,
				})),
				{ deliveryKey },
			),
			messageOrigin: 'agent-results',
			acceptClaim: subagentResultsTurnClaim({
				parentSessionId,
				deliveryKey,
				claims: finished,
			}),
		});
	} catch (error) {
		logger.warn('[subagent] result delivery failed; will retry on idle', {
			parentSessionId,
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}

	const delivered = finished;

	publish({
		type: 'session.updated',
		sessionId: parentSessionId,
		projectRoot: cfg.projectRoot,
		payload: {
			id: parentSessionId,
			subagentsFinished: delivered.map((record) => ({
				subagentId: record.id,
				childSessionId: record.childSessionId,
				agent: record.agent,
				status: record.status,
			})),
		},
	});

	logger.info('[subagent] reported results to parent', {
		parentSessionId,
		count: delivered.length,
		deliveryKey,
	});
	return true;
}
