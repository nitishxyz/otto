import { messages, sessions } from '@ottocode/database/schema';
import {
	estimateModelCostUsd,
	getAllAuth,
	type ProviderId,
} from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import { touchProject } from '../../runtime/projects/registry.ts';
import { loadProjectDb } from '../sessions/service.ts';
import { bucketAuth, resolveAuthKind } from './auth.ts';
import type { ProjectAggregate } from './types.ts';

function dateKey(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function emptyAggregate(): ProjectAggregate {
	return {
		totals: {
			messages: 0,
			sessions: 0,
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
			cacheCreationInputTokens: 0,
			reasoningTokens: 0,
			costUsd: 0,
			notionalCostUsd: 0,
			savedUsd: 0,
			costByAuth: { oauth: 0, api: 0, subscription: 0 },
			messagesByAuth: { oauth: 0, api: 0, subscription: 0 },
		},
		providers: new Map(),
		models: new Map(),
		daily: new Map(),
		missingPricing: new Set(),
	};
}

/**
 * Aggregate usage for a single project. Opens the project's DB (running
 * migrations idempotently), reads assistant messages, and rolls them up.
 */
export async function aggregateProject(projectRoot: string): Promise<{
	projectRoot: string;
	agg: ProjectAggregate;
	sessionCount: number;
}> {
	const { cfg, db } = await loadProjectDb(projectRoot);
	const auth = await getAllAuth(cfg.projectRoot);

	const sessionRows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.projectPath, cfg.projectRoot));

	const sessionIds = new Set<string>(sessionRows.map((session) => session.id));

	let messageRows: Array<typeof messages.$inferSelect> = [];
	if (sessionIds.size > 0) {
		const fetched = await db.select().from(messages);
		messageRows = fetched.filter(
			(message) =>
				message.role === 'assistant' && sessionIds.has(message.sessionId),
		);
	}

	const agg = emptyAggregate();
	const providerSessions = new Map<string, Set<string>>();

	for (const message of messageRows) {
		const provider = message.provider || 'unknown';
		const model = message.model || 'unknown';
		const authKind = resolveAuthKind(provider, auth);
		const inputTokens = message.inputTokens ?? 0;
		const outputTokens = message.outputTokens ?? 0;
		const cachedInputTokens = message.cachedInputTokens ?? 0;
		const cacheCreationInputTokens = message.cacheCreationInputTokens ?? 0;
		const reasoningTokens = message.reasoningTokens ?? 0;

		const notionalEstimate =
			estimateModelCostUsd(provider as ProviderId, model, {
				inputTokens,
				outputTokens,
				cachedInputTokens,
				cacheCreationInputTokens,
			}) ?? 0;

		let cost = 0;
		if (authKind === 'oauth' || authKind === 'subscription') {
			cost = 0;
		} else if (notionalEstimate === 0) {
			if (inputTokens > 0 || outputTokens > 0) {
				agg.missingPricing.add(`${provider}/${model}`);
			}
		} else {
			cost = notionalEstimate;
		}

		agg.totals.messages += 1;
		agg.totals.inputTokens += inputTokens;
		agg.totals.outputTokens += outputTokens;
		agg.totals.cachedInputTokens += cachedInputTokens;
		agg.totals.cacheCreationInputTokens += cacheCreationInputTokens;
		agg.totals.reasoningTokens += reasoningTokens;
		agg.totals.costUsd += cost;
		agg.totals.notionalCostUsd += notionalEstimate;

		const bucket = bucketAuth(authKind);
		agg.totals.costByAuth[bucket] += cost;
		agg.totals.messagesByAuth[bucket] += 1;

		let pSessions = providerSessions.get(provider);
		if (!pSessions) {
			pSessions = new Set();
			providerSessions.set(provider, pSessions);
		}
		pSessions.add(message.sessionId);

		let providerAgg = agg.providers.get(provider);
		if (!providerAgg) {
			providerAgg = {
				provider,
				authType: authKind,
				messages: 0,
				sessions: 0,
				inputTokens: 0,
				outputTokens: 0,
				cachedInputTokens: 0,
				cacheCreationInputTokens: 0,
				reasoningTokens: 0,
				costUsd: 0,
				notionalCostUsd: 0,
			};
			agg.providers.set(provider, providerAgg);
		}
		providerAgg.messages += 1;
		providerAgg.inputTokens += inputTokens;
		providerAgg.outputTokens += outputTokens;
		providerAgg.cachedInputTokens += cachedInputTokens;
		providerAgg.cacheCreationInputTokens += cacheCreationInputTokens;
		providerAgg.reasoningTokens += reasoningTokens;
		providerAgg.costUsd += cost;
		providerAgg.notionalCostUsd += notionalEstimate;

		const modelKey = `${provider}|${model}`;
		let modelAgg = agg.models.get(modelKey);
		if (!modelAgg) {
			modelAgg = {
				provider,
				model,
				authType: authKind,
				messages: 0,
				inputTokens: 0,
				outputTokens: 0,
				cachedInputTokens: 0,
				cacheCreationInputTokens: 0,
				reasoningTokens: 0,
				costUsd: 0,
				notionalCostUsd: 0,
			};
			agg.models.set(modelKey, modelAgg);
		}
		modelAgg.messages += 1;
		modelAgg.inputTokens += inputTokens;
		modelAgg.outputTokens += outputTokens;
		modelAgg.cachedInputTokens += cachedInputTokens;
		modelAgg.cacheCreationInputTokens += cacheCreationInputTokens;
		modelAgg.reasoningTokens += reasoningTokens;
		modelAgg.costUsd += cost;
		modelAgg.notionalCostUsd += notionalEstimate;

		const dailyKey = dateKey(message.createdAt);
		let dailyAgg = agg.daily.get(dailyKey);
		if (!dailyAgg) {
			dailyAgg = {
				date: dailyKey,
				messages: 0,
				inputTokens: 0,
				outputTokens: 0,
				costUsd: 0,
				notionalCostUsd: 0,
				costByAuth: { oauth: 0, api: 0, subscription: 0 },
				notionalByAuth: { oauth: 0, api: 0, subscription: 0 },
			};
			agg.daily.set(dailyKey, dailyAgg);
		}
		dailyAgg.messages += 1;
		dailyAgg.inputTokens += inputTokens;
		dailyAgg.outputTokens += outputTokens;
		dailyAgg.costUsd += cost;
		dailyAgg.notionalCostUsd += notionalEstimate;
		dailyAgg.costByAuth[bucket] += cost;
		dailyAgg.notionalByAuth[bucket] += notionalEstimate;
	}

	for (const provider of agg.providers.values()) {
		provider.sessions = providerSessions.get(provider.provider)?.size ?? 0;
	}
	agg.totals.sessions = sessionRows.length;
	agg.totals.savedUsd = Math.max(
		0,
		agg.totals.notionalCostUsd - agg.totals.costUsd,
	);

	// Register / refresh this project in the global registry.
	void touchProject(cfg.projectRoot, cfg.paths.dbPath);

	return {
		projectRoot: cfg.projectRoot,
		agg,
		sessionCount: sessionRows.length,
	};
}

export function mergeAggregate(
	into: ProjectAggregate,
	src: ProjectAggregate,
): void {
	into.totals.messages += src.totals.messages;
	into.totals.sessions += src.totals.sessions;
	into.totals.inputTokens += src.totals.inputTokens;
	into.totals.outputTokens += src.totals.outputTokens;
	into.totals.cachedInputTokens += src.totals.cachedInputTokens;
	into.totals.cacheCreationInputTokens += src.totals.cacheCreationInputTokens;
	into.totals.reasoningTokens += src.totals.reasoningTokens;
	into.totals.costUsd += src.totals.costUsd;
	into.totals.notionalCostUsd += src.totals.notionalCostUsd;
	into.totals.savedUsd += src.totals.savedUsd;
	for (const key of ['oauth', 'api', 'subscription'] as const) {
		into.totals.costByAuth[key] += src.totals.costByAuth[key];
		into.totals.messagesByAuth[key] += src.totals.messagesByAuth[key];
	}

	for (const [key, provider] of src.providers) {
		const existing = into.providers.get(key);
		if (!existing) {
			into.providers.set(key, { ...provider });
			continue;
		}
		existing.messages += provider.messages;
		existing.sessions += provider.sessions;
		existing.inputTokens += provider.inputTokens;
		existing.outputTokens += provider.outputTokens;
		existing.cachedInputTokens += provider.cachedInputTokens;
		existing.cacheCreationInputTokens += provider.cacheCreationInputTokens;
		existing.reasoningTokens += provider.reasoningTokens;
		existing.costUsd += provider.costUsd;
		existing.notionalCostUsd += provider.notionalCostUsd;
		if (existing.authType === 'unknown') existing.authType = provider.authType;
	}

	for (const [key, model] of src.models) {
		const existing = into.models.get(key);
		if (!existing) {
			into.models.set(key, { ...model });
			continue;
		}
		existing.messages += model.messages;
		existing.inputTokens += model.inputTokens;
		existing.outputTokens += model.outputTokens;
		existing.cachedInputTokens += model.cachedInputTokens;
		existing.cacheCreationInputTokens += model.cacheCreationInputTokens;
		existing.reasoningTokens += model.reasoningTokens;
		existing.costUsd += model.costUsd;
		existing.notionalCostUsd += model.notionalCostUsd;
		if (existing.authType === 'unknown') existing.authType = model.authType;
	}

	for (const [key, daily] of src.daily) {
		const existing = into.daily.get(key);
		if (!existing) {
			into.daily.set(key, {
				...daily,
				costByAuth: { ...daily.costByAuth },
				notionalByAuth: { ...daily.notionalByAuth },
			});
			continue;
		}
		existing.messages += daily.messages;
		existing.inputTokens += daily.inputTokens;
		existing.outputTokens += daily.outputTokens;
		existing.costUsd += daily.costUsd;
		existing.notionalCostUsd += daily.notionalCostUsd;
		for (const kk of ['oauth', 'api', 'subscription'] as const) {
			existing.costByAuth[kk] += daily.costByAuth[kk];
			existing.notionalByAuth[kk] += daily.notionalByAuth[kk];
		}
	}

	for (const key of src.missingPricing) into.missingPricing.add(key);
}
