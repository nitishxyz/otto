import { messages, sessions } from '@ottocode/database/schema';
import { estimateModelCostUsd, type ProviderId } from '@ottocode/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import type { MessageRow, ProjectDbContext, SessionRow } from './types.ts';

export interface SessionCostSummary {
	ownCostUsd: number;
	subagentCostUsd: number;
	totalCostUsd: number;
}

type CostMessageRow = Pick<
	MessageRow,
	| 'sessionId'
	| 'provider'
	| 'model'
	| 'inputTokens'
	| 'outputTokens'
	| 'cachedInputTokens'
	| 'cacheCreationInputTokens'
>;

type CostUsageBucket = {
	sessionId: string;
	provider: string;
	model: string;
	own: boolean;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	cacheCreationInputTokens: number;
};

function emptySessionCostSummary(): SessionCostSummary {
	return { ownCostUsd: 0, subagentCostUsd: 0, totalCostUsd: 0 };
}

function addCost(summary: SessionCostSummary, costUsd: number, own: boolean) {
	if (own) summary.ownCostUsd += costUsd;
	else summary.subagentCostUsd += costUsd;
	summary.totalCostUsd += costUsd;
}

function estimateUsageCostUsd(usage: CostUsageBucket): number {
	const cost = estimateModelCostUsd(usage.provider as ProviderId, usage.model, {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cachedInputTokens: usage.cachedInputTokens,
		cacheCreationInputTokens: usage.cacheCreationInputTokens,
	});
	return typeof cost === 'number' && Number.isFinite(cost) ? cost : 0;
}

function bucketKey(
	sessionId: string,
	provider: string,
	model: string,
	own: boolean,
) {
	return [sessionId, provider, model, own ? 'own' : 'subagent'].join('\0');
}

function addUsageToBucket(
	buckets: Map<string, CostUsageBucket>,
	targetSessionId: string,
	message: CostMessageRow,
	own: boolean,
) {
	const key = bucketKey(targetSessionId, message.provider, message.model, own);
	let bucket = buckets.get(key);
	if (!bucket) {
		bucket = {
			sessionId: targetSessionId,
			provider: message.provider,
			model: message.model,
			own,
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
			cacheCreationInputTokens: 0,
		};
		buckets.set(key, bucket);
	}
	bucket.inputTokens += Number(message.inputTokens ?? 0);
	bucket.outputTokens += Number(message.outputTokens ?? 0);
	bucket.cachedInputTokens += Number(message.cachedInputTokens ?? 0);
	bucket.cacheCreationInputTokens += Number(
		message.cacheCreationInputTokens ?? 0,
	);
}

function roundCost(costUsd: number): number {
	return Number.isFinite(costUsd) ? Number(costUsd.toFixed(6)) : 0;
}

/**
 * Computes session cost from message-level provider/model usage. Direct
 * sub-agent child sessions are attributed to their parent so a parent session
 * shows the full delegated cost even when children use different models.
 */
export async function getSessionCostSummaries(
	db: ProjectDbContext['db'],
	rows: SessionRow[],
): Promise<Map<string, SessionCostSummary>> {
	const summaries = new Map<string, SessionCostSummary>();
	if (!rows.length) return summaries;

	const directIds = rows.map((row) => row.id);
	const directIdSet = new Set(directIds);
	for (const id of directIds) summaries.set(id, emptySessionCostSummary());

	const childRows = await db
		.select({ id: sessions.id, parentSessionId: sessions.parentSessionId })
		.from(sessions)
		.where(
			and(
				inArray(sessions.parentSessionId, directIds),
				eq(sessions.sessionType, 'subagent'),
			),
		);
	const childToParent = new Map<string, string>();
	for (const child of childRows) {
		if (child.parentSessionId)
			childToParent.set(child.id, child.parentSessionId);
	}

	const messageSessionIds = Array.from(
		new Set([...directIds, ...childRows.map((child) => child.id)]),
	);
	const usageRows = await db
		.select({
			sessionId: messages.sessionId,
			provider: messages.provider,
			model: messages.model,
			inputTokens: messages.inputTokens,
			outputTokens: messages.outputTokens,
			cachedInputTokens: messages.cachedInputTokens,
			cacheCreationInputTokens: messages.cacheCreationInputTokens,
		})
		.from(messages)
		.where(inArray(messages.sessionId, messageSessionIds));

	const usageBuckets = new Map<string, CostUsageBucket>();
	for (const usage of usageRows) {
		if (directIdSet.has(usage.sessionId)) {
			addUsageToBucket(usageBuckets, usage.sessionId, usage, true);
		}
		const parentId = childToParent.get(usage.sessionId);
		if (parentId) {
			addUsageToBucket(usageBuckets, parentId, usage, false);
		}
	}

	for (const usage of usageBuckets.values()) {
		const costUsd = estimateUsageCostUsd(usage);
		if (costUsd <= 0) continue;
		const summary = summaries.get(usage.sessionId);
		if (summary) addCost(summary, costUsd, usage.own);
	}

	for (const summary of summaries.values()) {
		summary.ownCostUsd = roundCost(summary.ownCostUsd);
		summary.subagentCostUsd = roundCost(summary.subagentCostUsd);
		summary.totalCostUsd = roundCost(summary.totalCostUsd);
	}

	return summaries;
}

export function attachSessionCostSummary<TRow extends Record<string, unknown>>(
	row: TRow,
	summary: SessionCostSummary | undefined,
) {
	const cost = summary ?? emptySessionCostSummary();
	return {
		...row,
		ownCostUsd: cost.ownCostUsd,
		subagentCostUsd: cost.subagentCostUsd,
		totalCostUsd: cost.totalCostUsd,
	};
}
