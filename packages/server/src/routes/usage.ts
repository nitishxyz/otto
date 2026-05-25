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

type AuthKind = 'oauth' | 'api' | 'wallet' | 'subscription' | 'unknown';

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

interface UsageStatsResponse {
	project: string;
	generatedAt: number;
	totals: {
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
	};
	providers: ProviderAgg[];
	models: ModelAgg[];
	daily: DailyAgg[];
	notes: {
		oauthProviders: string[];
		subscriptionProviders: string[];
		missingPricing: string[];
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

function bucketAuth(kind: AuthKind): 'oauth' | 'api' | 'subscription' {
	if (kind === 'oauth') return 'oauth';
	if (kind === 'subscription' || kind === 'wallet') return 'subscription';
	return 'api';
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
								type: 'object',
								additionalProperties: true,
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const projectRoot = c.req.query('project') || process.cwd();
				const { cfg, db } = await loadProjectDb(projectRoot);
				const auth = await getAllAuth(cfg.projectRoot);

				const sessionRows = await db
					.select()
					.from(sessions)
					.where(eq(sessions.projectPath, cfg.projectRoot));

				const sessionIds = new Set<string>(sessionRows.map((s) => s.id));

				let messageRows: Array<typeof messages.$inferSelect> = [];
				if (sessionIds.size > 0) {
					// Fetch all assistant messages for these sessions.
					// We do a simple full scan per session; sessions tend to be small.
					const fetched = await db.select().from(messages);
					messageRows = fetched.filter(
						(m) => m.role === 'assistant' && sessionIds.has(m.sessionId),
					);
				}

				const providersMap = new Map<string, ProviderAgg>();
				const modelsMap = new Map<string, ModelAgg>();
				const dailyMap = new Map<string, DailyAgg>();
				const missingPricing = new Set<string>();
				const providerSessions = new Map<string, Set<string>>();

				let totalCost = 0;
				let totalMessages = 0;
				let totalInput = 0;
				let totalOutput = 0;
				let totalCachedInput = 0;
				let totalCacheCreate = 0;
				let totalReasoning = 0;
				let totalNotional = 0;
				const costByAuth = { oauth: 0, api: 0, subscription: 0 };
				const messagesByAuth = { oauth: 0, api: 0, subscription: 0 };

				for (const m of messageRows) {
					const provider = m.provider || 'unknown';
					const model = m.model || 'unknown';
					const authKind = resolveAuthKind(provider, auth);
					const inputTokens = m.inputTokens ?? 0;
					const outputTokens = m.outputTokens ?? 0;
					const cachedInputTokens = m.cachedInputTokens ?? 0;
					const cacheCreationInputTokens = m.cacheCreationInputTokens ?? 0;
					const reasoningTokens = m.reasoningTokens ?? 0;

					// "Notional" cost — what these tokens would cost as pay-as-you-go.
					// Always computed from catalog pricing, regardless of auth type.
					const notionalEstimate =
						estimateModelCostUsd(provider as ProviderId, model, {
							inputTokens,
							outputTokens,
							cachedInputTokens,
							cacheCreationInputTokens,
						}) ?? 0;

					let cost = 0;
					// For OAuth and subscription providers, there's no marginal per-token
					// cost — those are covered by the user's plan. We still keep
					// token counts but mark cost as 0.
					if (authKind === 'oauth' || authKind === 'subscription') {
						cost = 0;
					} else {
						if (notionalEstimate === 0) {
							if (inputTokens > 0 || outputTokens > 0) {
								missingPricing.add(`${provider}/${model}`);
							}
						} else {
							cost = notionalEstimate;
						}
					}

					totalMessages += 1;
					totalInput += inputTokens;
					totalOutput += outputTokens;
					totalCachedInput += cachedInputTokens;
					totalCacheCreate += cacheCreationInputTokens;
					totalReasoning += reasoningTokens;
					totalCost += cost;
					totalNotional += notionalEstimate;

					const bucket = bucketAuth(authKind);
					costByAuth[bucket] += cost;
					messagesByAuth[bucket] += 1;

					// Track which sessions touched a provider
					let pSessions = providerSessions.get(provider);
					if (!pSessions) {
						pSessions = new Set();
						providerSessions.set(provider, pSessions);
					}
					pSessions.add(m.sessionId);

					// Provider aggregation
					const pKey = provider;
					let pAgg = providersMap.get(pKey);
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
						providersMap.set(pKey, pAgg);
					}
					pAgg.messages += 1;
					pAgg.inputTokens += inputTokens;
					pAgg.outputTokens += outputTokens;
					pAgg.cachedInputTokens += cachedInputTokens;
					pAgg.cacheCreationInputTokens += cacheCreationInputTokens;
					pAgg.reasoningTokens += reasoningTokens;
					pAgg.costUsd += cost;
					pAgg.notionalCostUsd += notionalEstimate;

					// Model aggregation
					const mKey = `${provider}|${model}`;
					let mAgg = modelsMap.get(mKey);
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
						modelsMap.set(mKey, mAgg);
					}
					mAgg.messages += 1;
					mAgg.inputTokens += inputTokens;
					mAgg.outputTokens += outputTokens;
					mAgg.cachedInputTokens += cachedInputTokens;
					mAgg.cacheCreationInputTokens += cacheCreationInputTokens;
					mAgg.reasoningTokens += reasoningTokens;
					mAgg.costUsd += cost;
					mAgg.notionalCostUsd += notionalEstimate;

					// Daily aggregation
					const dKey = dateKey(m.createdAt);
					let dAgg = dailyMap.get(dKey);
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
						dailyMap.set(dKey, dAgg);
					}
					dAgg.messages += 1;
					dAgg.inputTokens += inputTokens;
					dAgg.outputTokens += outputTokens;
					dAgg.costUsd += cost;
					dAgg.notionalCostUsd += notionalEstimate;
					dAgg.costByAuth[bucket] += cost;
					dAgg.notionalByAuth[bucket] += notionalEstimate;
				}

				// Finalize per-provider session counts
				for (const agg of providersMap.values()) {
					agg.sessions = providerSessions.get(agg.provider)?.size ?? 0;
				}

				const providersArr = Array.from(providersMap.values()).sort(
					(a, b) =>
						b.notionalCostUsd - a.notionalCostUsd || b.messages - a.messages,
				);
				const modelsArr = Array.from(modelsMap.values()).sort(
					(a, b) =>
						b.notionalCostUsd - a.notionalCostUsd || b.messages - a.messages,
				);
				const dailyArr = Array.from(dailyMap.values()).sort((a, b) =>
					a.date.localeCompare(b.date),
				);

				const oauthProviders = providersArr
					.filter((p) => p.authType === 'oauth')
					.map((p) => p.provider);
				const subscriptionProviders = providersArr
					.filter(
						(p) => p.authType === 'subscription' || p.authType === 'wallet',
					)
					.map((p) => p.provider);

				const response: UsageStatsResponse = {
					project: cfg.projectRoot,
					generatedAt: Date.now(),
					totals: {
						messages: totalMessages,
						sessions: sessionRows.length,
						inputTokens: totalInput,
						outputTokens: totalOutput,
						cachedInputTokens: totalCachedInput,
						cacheCreationInputTokens: totalCacheCreate,
						reasoningTokens: totalReasoning,
						costUsd: Number(totalCost.toFixed(6)),
						notionalCostUsd: Number(totalNotional.toFixed(6)),
						savedUsd: Number(Math.max(0, totalNotional - totalCost).toFixed(6)),
						costByAuth: {
							oauth: Number(costByAuth.oauth.toFixed(6)),
							api: Number(costByAuth.api.toFixed(6)),
							subscription: Number(costByAuth.subscription.toFixed(6)),
						},
						messagesByAuth,
					},
					providers: providersArr.map((p) => ({
						...p,
						costUsd: Number(p.costUsd.toFixed(6)),
						notionalCostUsd: Number(p.notionalCostUsd.toFixed(6)),
					})),
					models: modelsArr.map((m) => ({
						...m,
						costUsd: Number(m.costUsd.toFixed(6)),
						notionalCostUsd: Number(m.notionalCostUsd.toFixed(6)),
					})),
					daily: dailyArr.map((d) => ({
						...d,
						costUsd: Number(d.costUsd.toFixed(6)),
						notionalCostUsd: Number(d.notionalCostUsd.toFixed(6)),
						costByAuth: {
							oauth: Number(d.costByAuth.oauth.toFixed(6)),
							api: Number(d.costByAuth.api.toFixed(6)),
							subscription: Number(d.costByAuth.subscription.toFixed(6)),
						},
						notionalByAuth: {
							oauth: Number(d.notionalByAuth.oauth.toFixed(6)),
							api: Number(d.notionalByAuth.api.toFixed(6)),
							subscription: Number(d.notionalByAuth.subscription.toFixed(6)),
						},
					})),
					notes: {
						oauthProviders,
						subscriptionProviders,
						missingPricing: Array.from(missingPricing).sort(),
					},
				};

				return c.json(response);
			} catch (error) {
				logger.error('Failed to compute usage stats', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
