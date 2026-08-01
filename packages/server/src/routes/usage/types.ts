export type AuthKind = 'oauth' | 'api' | 'wallet' | 'subscription' | 'unknown';
export type AuthBucket = 'oauth' | 'api' | 'subscription';

export interface ProviderAgg {
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

export interface ModelAgg {
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

export interface DailyAgg {
	date: string;
	messages: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	notionalCostUsd: number;
	costByAuth: { oauth: number; api: number; subscription: number };
	notionalByAuth: { oauth: number; api: number; subscription: number };
}

export interface UsageTotals {
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

export interface UsageStatsResponse {
	scope: 'project' | 'global';
	project: string;
	generatedAt: number;
	/** Window every aggregate below is restricted to. `days: null` is all-time. */
	range: { days: number | null; since: number | null };
	totals: UsageTotals;
	/** Totals for the preceding window of equal length, for period deltas. */
	previousTotals: UsageTotals | null;
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

export interface ProjectAggregate {
	totals: UsageTotals;
	/** Totals for the window immediately preceding the selected one. */
	previousTotals: UsageTotals;
	providers: Map<string, ProviderAgg>;
	models: Map<string, ModelAgg>;
	daily: Map<string, DailyAgg>;
	missingPricing: Set<string>;
}
