import { extractErrorMessage, getBaseUrl } from './utils';

export type UsageAuthBucket = 'oauth' | 'api' | 'subscription';

export interface UsageProviderAgg {
	provider: string;
	authType: 'oauth' | 'api' | 'wallet' | 'subscription' | 'unknown';
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

export interface UsageModelAgg {
	provider: string;
	model: string;
	authType: UsageProviderAgg['authType'];
	messages: number;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	cacheCreationInputTokens: number;
	reasoningTokens: number;
	costUsd: number;
	notionalCostUsd: number;
}

export interface UsageDailyAgg {
	date: string;
	messages: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	notionalCostUsd: number;
	costByAuth: { oauth: number; api: number; subscription: number };
	notionalByAuth: { oauth: number; api: number; subscription: number };
}

export interface UsageStats {
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
	providers: UsageProviderAgg[];
	models: UsageModelAgg[];
	daily: UsageDailyAgg[];
	notes: {
		oauthProviders: string[];
		subscriptionProviders: string[];
		missingPricing: string[];
	};
}

export const usageMixin = {
	async getUsageStats(): Promise<UsageStats> {
		const base = getBaseUrl().replace(/\/+$/, '');
		const res = await fetch(`${base}/v1/usage/stats`, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
		});
		if (!res.ok) {
			let body: unknown;
			try {
				body = await res.json();
			} catch {
				body = await res.text().catch(() => '');
			}
			throw new Error(extractErrorMessage(body) || `HTTP ${res.status}`);
		}
		return (await res.json()) as UsageStats;
	},
};
