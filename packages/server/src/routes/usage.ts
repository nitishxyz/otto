import type { Hono } from 'hono';
import { messages, sessions } from '@ottocode/database/schema';
import {
	estimateModelCostUsd,
	getAllAuth,
	logger,
	type ProviderId,
} from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import { openApiRoute } from '../openapi/route.ts';
import { serializeError } from '../runtime/errors/api-error.ts';
import { loadProjectDb } from './sessions/service.ts';
import { listProjects, touchProject } from '../runtime/projects/registry.ts';

type AuthKind = 'oauth' | 'api' | 'wallet' | 'subscription' | 'unknown';
type AuthBucket = 'oauth' | 'api' | 'subscription';

interface ProviderAgg {
	provider: string;
	authType: AuthKind;
	messages: number;
	sessions: number;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	cacheCreationInputTokens: number;
	reasoningTokens: number;
	costUsd: number;
	notionalCostUsd: number;
}

interface ModelAgg {
	provider: string;
	model: string;
	authType: AuthKind;
	messages: number;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	cacheCreationInputTokens: number;
	reasoningTokens: number;
	costUsd: number;
	notionalCostUsd: number;
}

interface DailyAgg {
	date: string;
	messages: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	notionalCostUsd: number;
	costByAuth: { oauth: number; api: number; subscription: number };
	notionalByAuth: { oauth: number; api: number; subscription: number };
}

interface UsageTotals {
	messages: number;
	sessions: number;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	cacheCreationInputTokens: number;
	reasoningTokens: number;
	costUsd: number;
	notionalCostUsd: number;
	savedUsd: number;
	costByAuth: { oauth: number; api: number; subscription: number };
	messagesByAuth: { oauth: number; api: number; subscription: number };
}

interface UsageStatsResponse {
	scope: 'project' | 'global';
	project: string;
	generatedAt: number;
	totals: UsageTotals;
	providers: ProviderAgg[];
	models: ModelAgg[];
	daily: DailyAgg[];
	notes: {
		oauthProviders: string[];
		subscriptionProviders: string[];
		missingPricing: string[];
	};
	projects?: {
		included: Array<{
			id: string;
			name: string;
			path: string;
			lastSeenAt: number;
			messages: number;
			notionalCostUsd: number;
		}>;
		unavailable: Array<{
			id: string;
			name: string;
			path: string;
			reason: string;
		}>;
	};
}

function resolveAuthKind(
	provider: string,
	currentAuth: Awaited<ReturnType<typeof getAllAuth>>,
): AuthKind {
	// OttoRouter / Setu is its own subscription/credits-based service.
	if (provider === 'ottorouter') return 'subscription';
	// Copilot is subscription-based (GitHub Copilot)
	if (provider === 'copilot') return 'subscription';

	const auth = currentAuth[provider as ProviderId];
	if (!auth) return 'unknown';
	if (auth.type === 'oauth') return 'oauth';
	if (auth.type === 'api') return 'api';
	if ((auth as { type?: string }).type === 'wallet') return 'wallet';
	return 'unknown';
}

function dateKey(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function bucketAuth(kind: AuthKind): AuthBucket {
	if (kind === 'oauth') return 'oauth';
	if (kind === 'subscription' || kind === 'wallet') return 'subscription';
	return 'api';
}

interface ProjectAggregate {
	totals: UsageTotals;
	providers: Map<string, ProviderAgg>;
	models: Map<string, ModelAgg>;
	daily: Map<string, DailyAgg>;
	missingPricing: Set<string>;
}

function emptyAggregate(): ProjectAggregate {
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
async function aggregateProject(projectRoot: string): Promise<{
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

	const sessionIds = new Set<string>(sessionRows.map((s) => s.id));

	let messageRows: Array<typeof messages.$inferSelect> = [];
	if (sessionIds.size > 0) {
		const fetched = await db.select().from(messages);
		messageRows = fetched.filter(
			(m) => m.role === 'assistant' && sessionIds.has(m.sessionId),
		);
	}

	const agg = emptyAggregate();
	const providerSessions = new Map<string, Set<string>>();

	for (const m of messageRows) {
		const provider = m.provider || 'unknown';
		const model = m.model || 'unknown';
		const authKind = resolveAuthKind(provider, auth);
		const inputTokens = m.inputTokens ?? 0;
		const outputTokens = m.outputTokens ?? 0;
		const cachedInputTokens = m.cachedInputTokens ?? 0;
		const cacheCreationInputTokens = m.cacheCreationInputTokens ?? 0;
		const reasoningTokens = m.reasoningTokens ?? 0;

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
		pSessions.add(m.sessionId);

		let pAgg = agg.providers.get(provider);
		if (!pAgg) {
			pAgg = {
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
			agg.providers.set(provider, pAgg);
		}
		pAgg.messages += 1;
		pAgg.inputTokens += inputTokens;
		pAgg.outputTokens += outputTokens;
		pAgg.cachedInputTokens += cachedInputTokens;
		pAgg.cacheCreationInputTokens += cacheCreationInputTokens;
		pAgg.reasoningTokens += reasoningTokens;
		pAgg.costUsd += cost;
		pAgg.notionalCostUsd += notionalEstimate;

		const mKey = `${provider}|${model}`;
		let mAgg = agg.models.get(mKey);
		if (!mAgg) {
			mAgg = {
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
			agg.models.set(mKey, mAgg);
		}
		mAgg.messages += 1;
		mAgg.inputTokens += inputTokens;
		mAgg.outputTokens += outputTokens;
		mAgg.cachedInputTokens += cachedInputTokens;
		mAgg.cacheCreationInputTokens += cacheCreationInputTokens;
		mAgg.reasoningTokens += reasoningTokens;
		mAgg.costUsd += cost;
		mAgg.notionalCostUsd += notionalEstimate;

		const dKey = dateKey(m.createdAt);
		let dAgg = agg.daily.get(dKey);
		if (!dAgg) {
			dAgg = {
				date: dKey,
				messages: 0,
				inputTokens: 0,
				outputTokens: 0,
				costUsd: 0,
				notionalCostUsd: 0,
				costByAuth: { oauth: 0, api: 0, subscription: 0 },
				notionalByAuth: { oauth: 0, api: 0, subscription: 0 },
			};
			agg.daily.set(dKey, dAgg);
		}
		dAgg.messages += 1;
		dAgg.inputTokens += inputTokens;
		dAgg.outputTokens += outputTokens;
		dAgg.costUsd += cost;
		dAgg.notionalCostUsd += notionalEstimate;
		dAgg.costByAuth[bucket] += cost;
		dAgg.notionalByAuth[bucket] += notionalEstimate;
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

function mergeAggregate(into: ProjectAggregate, src: ProjectAggregate): void {
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
	for (const k of ['oauth', 'api', 'subscription'] as const) {
		into.totals.costByAuth[k] += src.totals.costByAuth[k];
		into.totals.messagesByAuth[k] += src.totals.messagesByAuth[k];
	}

	for (const [k, p] of src.providers) {
		const existing = into.providers.get(k);
		if (!existing) {
			into.providers.set(k, { ...p });
			continue;
		}
		existing.messages += p.messages;
		existing.sessions += p.sessions;
		existing.inputTokens += p.inputTokens;
		existing.outputTokens += p.outputTokens;
		existing.cachedInputTokens += p.cachedInputTokens;
		existing.cacheCreationInputTokens += p.cacheCreationInputTokens;
		existing.reasoningTokens += p.reasoningTokens;
		existing.costUsd += p.costUsd;
		existing.notionalCostUsd += p.notionalCostUsd;
		if (existing.authType === 'unknown') existing.authType = p.authType;
	}

	for (const [k, m] of src.models) {
		const existing = into.models.get(k);
		if (!existing) {
			into.models.set(k, { ...m });
			continue;
		}
		existing.messages += m.messages;
		existing.inputTokens += m.inputTokens;
		existing.outputTokens += m.outputTokens;
		existing.cachedInputTokens += m.cachedInputTokens;
		existing.cacheCreationInputTokens += m.cacheCreationInputTokens;
		existing.reasoningTokens += m.reasoningTokens;
		existing.costUsd += m.costUsd;
		existing.notionalCostUsd += m.notionalCostUsd;
		if (existing.authType === 'unknown') existing.authType = m.authType;
	}

	for (const [k, d] of src.daily) {
		const existing = into.daily.get(k);
		if (!existing) {
			into.daily.set(k, {
				...d,
				costByAuth: { ...d.costByAuth },
				notionalByAuth: { ...d.notionalByAuth },
			});
			continue;
		}
		existing.messages += d.messages;
		existing.inputTokens += d.inputTokens;
		existing.outputTokens += d.outputTokens;
		existing.costUsd += d.costUsd;
		existing.notionalCostUsd += d.notionalCostUsd;
		for (const kk of ['oauth', 'api', 'subscription'] as const) {
			existing.costByAuth[kk] += d.costByAuth[kk];
			existing.notionalByAuth[kk] += d.notionalByAuth[kk];
		}
	}

	for (const k of src.missingPricing) into.missingPricing.add(k);
}

function finalizeResponse(
	scope: 'project' | 'global',
	projectLabel: string,
	agg: ProjectAggregate,
	extras?: UsageStatsResponse['projects'],
): UsageStatsResponse {
	const providersArr = Array.from(agg.providers.values()).sort(
		(a, b) => b.notionalCostUsd - a.notionalCostUsd || b.messages - a.messages,
	);
	const modelsArr = Array.from(agg.models.values()).sort(
		(a, b) => b.notionalCostUsd - a.notionalCostUsd || b.messages - a.messages,
	);
	const dailyArr = Array.from(agg.daily.values()).sort((a, b) =>
		a.date.localeCompare(b.date),
	);

	const oauthProviders = providersArr
		.filter((p) => p.authType === 'oauth')
		.map((p) => p.provider);
	const subscriptionProviders = providersArr
		.filter((p) => p.authType === 'subscription' || p.authType === 'wallet')
		.map((p) => p.provider);

	const round = (n: number) => Number(n.toFixed(6));

	return {
		scope,
		project: projectLabel,
		generatedAt: Date.now(),
		totals: {
			messages: agg.totals.messages,
			sessions: agg.totals.sessions,
			inputTokens: agg.totals.inputTokens,
			outputTokens: agg.totals.outputTokens,
			cachedInputTokens: agg.totals.cachedInputTokens,
			cacheCreationInputTokens: agg.totals.cacheCreationInputTokens,
			reasoningTokens: agg.totals.reasoningTokens,
			costUsd: round(agg.totals.costUsd),
			notionalCostUsd: round(agg.totals.notionalCostUsd),
			savedUsd: round(agg.totals.savedUsd),
			costByAuth: {
				oauth: round(agg.totals.costByAuth.oauth),
				api: round(agg.totals.costByAuth.api),
				subscription: round(agg.totals.costByAuth.subscription),
			},
			messagesByAuth: agg.totals.messagesByAuth,
		},
		providers: providersArr.map((p) => ({
			...p,
			costUsd: round(p.costUsd),
			notionalCostUsd: round(p.notionalCostUsd),
		})),
		models: modelsArr.map((m) => ({
			...m,
			costUsd: round(m.costUsd),
			notionalCostUsd: round(m.notionalCostUsd),
		})),
		daily: dailyArr.map((d) => ({
			...d,
			costUsd: round(d.costUsd),
			notionalCostUsd: round(d.notionalCostUsd),
			costByAuth: {
				oauth: round(d.costByAuth.oauth),
				api: round(d.costByAuth.api),
				subscription: round(d.costByAuth.subscription),
			},
			notionalByAuth: {
				oauth: round(d.notionalByAuth.oauth),
				api: round(d.notionalByAuth.api),
				subscription: round(d.notionalByAuth.subscription),
			},
		})),
		notes: {
			oauthProviders,
			subscriptionProviders,
			missingPricing: Array.from(agg.missingPricing).sort(),
		},
		projects: extras,
	};
}

export function registerUsageRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/usage/stats',
			tags: ['usage'],
			operationId: 'getUsageStats',
			summary:
				'Get aggregated usage statistics for the current project (tokens, cost, by model/provider/day)',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: { type: 'string' },
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			responses: {
				'200': {
					description: 'Aggregated usage stats',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/UsageStats',
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const { projectRoot: resolvedRoot, agg } =
					await aggregateProject(projectRoot);
				const response = finalizeResponse('project', resolvedRoot, agg);
				return c.json(response);
			} catch (error) {
				logger.error('Failed to compute usage stats', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/usage/stats/global',
			tags: ['usage'],
			operationId: 'getGlobalUsageStats',
			summary:
				'Get aggregated usage statistics across all known otto projects (fan-out across local registries)',
			responses: {
				'200': {
					description: 'Aggregated usage stats across all registered projects',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/UsageStats',
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const cwd = process.cwd();
				// Ensure the current project is registered even if usage/stats
				// hasn't been hit yet this session.
				try {
					const { cfg } = await loadProjectDb(cwd);
					await touchProject(cfg.projectRoot, cfg.paths.dbPath);
				} catch {
					// best effort
				}

				const known = await listProjects();
				const merged = emptyAggregate();
				const included: NonNullable<
					UsageStatsResponse['projects']
				>['included'] = [];
				const unavailable: NonNullable<
					UsageStatsResponse['projects']
				>['unavailable'] = [];

				const results = await Promise.allSettled(
					known.map(async (proj) => {
						const dbFile = Bun.file(proj.dbPath);
						if (!(await dbFile.exists())) {
							throw new Error('database file not found');
						}
						const out = await aggregateProject(proj.path);
						return { proj, out };
					}),
				);

				for (let i = 0; i < results.length; i += 1) {
					const r = results[i];
					const proj = known[i];
					if (r.status === 'fulfilled') {
						mergeAggregate(merged, r.value.out.agg);
						included.push({
							id: proj.id,
							name: proj.name,
							path: proj.path,
							lastSeenAt: proj.lastSeenAt,
							messages: r.value.out.agg.totals.messages,
							notionalCostUsd: Number(
								r.value.out.agg.totals.notionalCostUsd.toFixed(6),
							),
						});
					} else {
						const reason =
							r.reason instanceof Error
								? r.reason.message
								: String(r.reason ?? 'unknown error');
						unavailable.push({
							id: proj.id,
							name: proj.name,
							path: proj.path,
							reason,
						});
					}
				}

				const label = `all projects (${included.length}${
					unavailable.length ? ` / ${included.length + unavailable.length}` : ''
				})`;
				const response = finalizeResponse('global', label, merged, {
					included: included.sort(
						(a, b) => b.notionalCostUsd - a.notionalCostUsd,
					),
					unavailable,
				});
				return c.json(response);
			} catch (error) {
				logger.error('Failed to compute global usage stats', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
