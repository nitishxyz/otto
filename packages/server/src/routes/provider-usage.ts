import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import {
	getAuth,
	refreshToken,
	refreshOpenAIToken,
	type ProviderId,
} from '@ottocode/sdk';
import { logger } from '@ottocode/sdk';
import { setAuth } from '@ottocode/sdk';
import { serializeError } from '../runtime/errors/api-error.ts';
import type { OAuth } from '@ottocode/sdk';
import { openApiRoute } from '../openapi/route.ts';

const USAGE_CACHE_TTL_MS = 60_000;

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
		const refreshFn = provider === 'openai' ? refreshOpenAIToken : refreshToken;
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

type ProviderUsage =
	| Awaited<ReturnType<typeof fetchAnthropicUsage>>
	| Awaited<ReturnType<typeof fetchOpenAIUsage>>;

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
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/provider-usage/{provider}',
			tags: ['config'],
			operationId: 'getProviderUsage',
			summary: 'Get usage information for an OAuth provider',
			parameters: [
				{
					in: 'path',
					name: 'provider',
					required: true,
					schema: {
						type: 'string',
						enum: ['anthropic', 'openai'],
					},
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									provider: {
										type: 'string',
									},
									primaryWindow: {
										type: 'object',
										nullable: true,
										properties: {
											usedPercent: {
												type: 'number',
											},
											windowSeconds: {
												type: 'integer',
											},
											resetsAt: {
												type: 'string',
												nullable: true,
											},
											resetAfterSeconds: {
												type: 'integer',
											},
										},
									},
									secondaryWindow: {
										type: 'object',
										nullable: true,
										properties: {
											usedPercent: {
												type: 'number',
											},
											windowSeconds: {
												type: 'integer',
											},
											resetsAt: {
												type: 'string',
												nullable: true,
											},
											resetAfterSeconds: {
												type: 'integer',
											},
										},
									},
									limitReached: {
										type: 'boolean',
									},
									planType: {
										type: 'string',
										nullable: true,
									},
								},
								required: ['provider', 'limitReached'],
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const provider = c.req.param('provider') as ProviderId;

				if (provider !== 'anthropic' && provider !== 'openai') {
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
