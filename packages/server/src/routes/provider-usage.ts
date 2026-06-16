import { createHash } from 'node:crypto';
import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import {
	getAuth,
	getGrokCliHeaders,
	refreshKimiToken,
	refreshToken,
	refreshOpenAIToken,
	type ProviderId,
} from '@ottocode/sdk';
import { logger } from '@ottocode/sdk';
import { setAuth } from '@ottocode/sdk';
import { serializeError } from '../runtime/errors/api-error.ts';
import type { OAuth } from '@ottocode/sdk';
import { zodOpenApiRoute } from '../openapi/route.ts';

const USAGE_CACHE_TTL_MS = 60_000;

const providerUsageParamsSchema = z.object({
	provider: z.enum(['anthropic', 'openai', 'xai', 'kimi']).openapi({
		param: { name: 'provider', in: 'path' },
	}),
});

const providerUsageWindowSchema = z.object({
	usedPercent: z.number().optional(),
	windowSeconds: z.number().int().optional(),
	resetsAt: z.string().nullable().optional(),
	resetAfterSeconds: z.number().int().optional(),
});

const providerUsageResponseSchema = z.object({
	provider: z.string(),
	primaryWindow: providerUsageWindowSchema.nullable().optional(),
	secondaryWindow: providerUsageWindowSchema.nullable().optional(),
	limitReached: z.boolean(),
	planType: z.string().nullable().optional(),
});

const providerUsageErrorSchema = z.object({
	error: z.union([z.string(), z.object({ message: z.string() })]),
});

async function ensureValidOAuth(
	provider: ProviderId,
): Promise<{ access: string; oauth: OAuth } | null> {
	const projectRoot = process.cwd();
	const auth = await getAuth(provider, projectRoot);
	if (!auth || auth.type !== 'oauth') return null;

	if (auth.access && auth.expires > Date.now()) {
		return { access: auth.access, oauth: auth };
	}

	try {
		const refreshFn =
			provider === 'openai'
				? refreshOpenAIToken
				: provider === 'kimi'
					? refreshKimiToken
					: refreshToken;
		const newTokens = await refreshFn(auth.refresh);
		const updated: OAuth = {
			...auth,
			access: newTokens.access,
			refresh: newTokens.refresh,
			expires: newTokens.expires,
		};
		await setAuth(provider, updated, projectRoot, 'global');
		return { access: updated.access, oauth: updated };
	} catch {
		return { access: auth.access, oauth: auth };
	}
}

async function fetchAnthropicUsage(access: string) {
	const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
		headers: {
			Authorization: `Bearer ${access}`,
			'anthropic-beta': 'oauth-2025-04-20',
			Accept: 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`Anthropic usage API returned ${response.status}`);
	}

	const data = (await response.json()) as {
		five_hour?: { utilization: number; resets_at: string | null };
		seven_day?: { utilization: number; resets_at: string | null };
		seven_day_sonnet?: { utilization: number; resets_at: string | null };
		extra_usage?: {
			is_enabled: boolean;
			monthly_limit: number;
			used_credits: number;
			utilization: number | null;
		};
	};

	return {
		provider: 'anthropic' as const,
		primaryWindow: data.five_hour
			? {
					usedPercent: data.five_hour.utilization,
					windowSeconds: 18000,
					resetsAt: data.five_hour.resets_at,
				}
			: null,
		secondaryWindow: data.seven_day
			? {
					usedPercent: data.seven_day.utilization,
					windowSeconds: 604800,
					resetsAt: data.seven_day.resets_at,
				}
			: null,
		sonnetWindow: data.seven_day_sonnet
			? {
					usedPercent: data.seven_day_sonnet.utilization,
					resetsAt: data.seven_day_sonnet.resets_at,
				}
			: null,
		extraUsage: data.extra_usage ?? null,
		limitReached: (data.five_hour?.utilization ?? 0) >= 100,
		raw: data,
	};
}

async function fetchOpenAIUsage(access: string, accountId?: string) {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${access}`,
		Accept: '*/*',
	};
	if (accountId) {
		headers['ChatGPT-Account-Id'] = accountId;
	}
	const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
		headers,
	});

	if (!response.ok) {
		throw new Error(`OpenAI usage API returned ${response.status}`);
	}

	const data = (await response.json()) as {
		plan_type?: string;
		rate_limit?: {
			allowed: boolean;
			limit_reached: boolean;
			primary_window?: {
				used_percent: number;
				limit_window_seconds: number;
				reset_after_seconds: number;
				reset_at: number;
			};
			secondary_window?: {
				used_percent: number;
				limit_window_seconds: number;
				reset_after_seconds: number;
				reset_at: number;
			} | null;
		};
		credits?: {
			has_credits: boolean;
			balance: number | null;
		};
	};

	const rl = data.rate_limit;
	return {
		provider: 'openai' as const,
		planType: data.plan_type ?? null,
		primaryWindow: rl?.primary_window
			? {
					usedPercent: rl.primary_window.used_percent,
					windowSeconds: rl.primary_window.limit_window_seconds,
					resetsAt: new Date(rl.primary_window.reset_at * 1000).toISOString(),
					resetAfterSeconds: rl.primary_window.reset_after_seconds,
				}
			: null,
		secondaryWindow: rl?.secondary_window
			? {
					usedPercent: rl.secondary_window.used_percent,
					windowSeconds: rl.secondary_window.limit_window_seconds,
					resetsAt: new Date(rl.secondary_window.reset_at * 1000).toISOString(),
					resetAfterSeconds: rl.secondary_window.reset_after_seconds,
				}
			: null,
		credits: data.credits ?? null,
		limitReached: rl?.limit_reached ?? false,
		raw: data,
	};
}

async function fetchXaiGrokUsage(access: string) {
	const response = await fetch('https://cli-chat-proxy.grok.com/v1/billing', {
		headers: {
			Authorization: `Bearer ${access}`,
			Accept: 'application/json',
			...getGrokCliHeaders('grok-build'),
		},
	});

	if (!response.ok) {
		throw new Error(`xAI Grok billing API returned ${response.status}`);
	}

	const data = (await response.json()) as {
		config?: {
			monthlyLimit?: { val?: number };
			used?: { val?: number };
			onDemandCap?: { val?: number };
			billingPeriodStart?: string;
			billingPeriodEnd?: string;
			history?: Array<{
				billingCycle?: string;
				includedUsed?: number;
				onDemandUsed?: number;
				totalUsed?: number;
			}>;
		};
	};

	const config = data.config ?? {};
	const monthlyLimit = config.monthlyLimit?.val ?? 0;
	const used = config.used?.val ?? 0;
	const onDemandCap = config.onDemandCap?.val ?? 0;
	const rawPercent = monthlyLimit > 0 ? (used / monthlyLimit) * 100 : 0;
	const usedPercent = Math.max(0, Math.min(rawPercent, 100));
	const start = config.billingPeriodStart
		? new Date(config.billingPeriodStart).getTime()
		: null;
	const end = config.billingPeriodEnd
		? new Date(config.billingPeriodEnd).getTime()
		: null;
	const windowSeconds =
		start && end && end > start ? Math.round((end - start) / 1000) : 2592000;

	return {
		provider: 'xai' as const,
		planType: 'Grok credits',
		primaryWindow: {
			usedPercent,
			windowSeconds,
			resetsAt: config.billingPeriodEnd ?? null,
		},
		secondaryWindow: null,
		limitReached: monthlyLimit > 0 && used >= monthlyLimit && onDemandCap <= 0,
		raw: data,
	};
}

function numericUsageValue(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function kimiUsedPercent(detail?: {
	limit?: unknown;
	used?: unknown;
	remaining?: unknown;
}) {
	const limit = numericUsageValue(detail?.limit) ?? 0;
	const used =
		numericUsageValue(detail?.used) ??
		Math.max(0, limit - (numericUsageValue(detail?.remaining) ?? limit));
	return limit > 0 ? Math.max(0, Math.min((used / limit) * 100, 100)) : 0;
}

function kimiWindowSeconds(window?: {
	duration?: unknown;
	timeUnit?: unknown;
}) {
	const duration = numericUsageValue(window?.duration);
	if (!duration) return undefined;
	const timeUnit = typeof window?.timeUnit === 'string' ? window.timeUnit : '';
	if (timeUnit.includes('MINUTE')) return Math.round(duration * 60);
	if (timeUnit.includes('HOUR')) return Math.round(duration * 3600);
	if (timeUnit.includes('DAY')) return Math.round(duration * 86400);
	return Math.round(duration);
}

async function fetchKimiUsage(access: string) {
	const response = await fetch('https://api.kimi.com/coding/v1/usages', {
		headers: {
			Authorization: `Bearer ${access}`,
			Accept: 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`Kimi usage API returned ${response.status}`);
	}

	const data = (await response.json()) as {
		user?: {
			membership?: { level?: string };
			discountPlan?: boolean;
		};
		usage?: {
			limit?: unknown;
			used?: unknown;
			remaining?: unknown;
			resetTime?: string;
		};
		limits?: Array<{
			window?: { duration?: unknown; timeUnit?: unknown };
			detail?: {
				limit?: unknown;
				used?: unknown;
				remaining?: unknown;
				resetTime?: string;
			};
		}>;
		totalQuota?: { limit?: unknown; used?: unknown; remaining?: unknown };
		subType?: string;
	};

	const firstLimit = data.limits?.[0];
	const quota = data.totalQuota ?? data.usage;
	const quotaLimit = numericUsageValue(quota?.limit) ?? 0;
	const quotaRemaining = numericUsageValue(quota?.remaining) ?? quotaLimit;

	return {
		provider: 'kimi' as const,
		planType: data.subType ?? data.user?.membership?.level ?? 'Kimi Code OAuth',
		primaryWindow: data.usage
			? {
					usedPercent: kimiUsedPercent(data.usage),
					windowSeconds: 604800,
					resetsAt: data.usage.resetTime ?? null,
				}
			: null,
		secondaryWindow: firstLimit?.detail
			? {
					usedPercent: kimiUsedPercent(firstLimit.detail),
					windowSeconds: kimiWindowSeconds(firstLimit.window),
					resetsAt: firstLimit.detail.resetTime ?? null,
				}
			: null,
		limitReached: quotaLimit > 0 && quotaRemaining <= 0,
		raw: data,
	};
}

type ProviderUsage =
	| Awaited<ReturnType<typeof fetchAnthropicUsage>>
	| Awaited<ReturnType<typeof fetchOpenAIUsage>>
	| Awaited<ReturnType<typeof fetchXaiGrokUsage>>
	| Awaited<ReturnType<typeof fetchKimiUsage>>;

type UsageCacheEntry = {
	data?: ProviderUsage;
	fetchedAt?: number;
	inflight?: Promise<ProviderUsage>;
};

const usageCache = new Map<string, UsageCacheEntry>();

function usageCacheIdentity(oauth: OAuth) {
	return (
		oauth.accountId ?? createHash('sha256').update(oauth.refresh).digest('hex')
	);
}

function usageCacheKey(provider: ProviderId, oauth: OAuth) {
	return [provider, usageCacheIdentity(oauth)].join(':');
}

async function fetchProviderUsage(
	provider: ProviderId,
	tokenResult: { access: string; oauth: OAuth },
) {
	const cacheKey = usageCacheKey(provider, tokenResult.oauth);
	const now = Date.now();
	const cached = usageCache.get(cacheKey);

	if (
		cached?.data &&
		cached.fetchedAt &&
		now - cached.fetchedAt < USAGE_CACHE_TTL_MS
	) {
		return cached.data;
	}

	if (cached?.inflight) return cached.inflight;

	const inflight =
		provider === 'anthropic'
			? fetchAnthropicUsage(tokenResult.access)
			: provider === 'xai'
				? fetchXaiGrokUsage(tokenResult.access)
				: provider === 'kimi'
					? fetchKimiUsage(tokenResult.access)
					: fetchOpenAIUsage(tokenResult.access, tokenResult.oauth.accountId);

	usageCache.set(cacheKey, {
		data: cached?.data,
		fetchedAt: cached?.fetchedAt,
		inflight,
	});

	try {
		const data = await inflight;
		usageCache.set(cacheKey, { data, fetchedAt: Date.now() });
		return data;
	} catch (error) {
		if (cached?.data && cached.fetchedAt) {
			usageCache.set(cacheKey, {
				data: cached.data,
				fetchedAt: cached.fetchedAt,
			});
		} else {
			usageCache.delete(cacheKey);
		}
		throw error;
	}
}

export function registerProviderUsageRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/provider-usage/{provider}',
			tags: ['config'],
			operationId: 'getProviderUsage',
			summary: 'Get usage information for an OAuth provider',
			request: {
				params: providerUsageParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: providerUsageResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: providerUsageErrorSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: providerUsageErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const provider = c.req.param('provider') as ProviderId;

				if (
					provider !== 'anthropic' &&
					provider !== 'openai' &&
					provider !== 'xai' &&
					provider !== 'kimi'
				) {
					return c.json(
						{ error: { message: 'Usage not supported for this provider' } },
						400,
					);
				}

				const tokenResult = await ensureValidOAuth(provider);
				if (!tokenResult) {
					return c.json(
						{
							error: {
								message: `No OAuth credentials for ${provider}. Usage is only available for OAuth-authenticated providers.`,
							},
						},
						404,
					);
				}

				const usage = await fetchProviderUsage(provider, tokenResult);
				c.header('Cache-Control', 'private, max-age=60');

				return c.json(usage);
			} catch (error) {
				logger.error('Failed to fetch provider usage', error);
				const errorResponse = serializeError(error);
				const status = (errorResponse.error.status || 500) as 500;
				return c.json(errorResponse, status);
			}
		},
	);
}
