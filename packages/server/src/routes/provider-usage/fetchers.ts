import { getGrokCliHeaders } from '@ottocode/sdk';

export async function fetchAnthropicUsage(access: string) {
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

export async function fetchOpenAIUsage(access: string, accountId?: string) {
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

export async function fetchXaiGrokUsage(access: string) {
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

export async function fetchKimiUsage(access: string) {
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

export type ProviderUsage =
	| Awaited<ReturnType<typeof fetchAnthropicUsage>>
	| Awaited<ReturnType<typeof fetchOpenAIUsage>>
	| Awaited<ReturnType<typeof fetchXaiGrokUsage>>
	| Awaited<ReturnType<typeof fetchKimiUsage>>;
