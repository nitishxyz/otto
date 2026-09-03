import type { getDb } from '@ottocode/database';

export type RuntimeDb = Awaited<ReturnType<typeof getDb>>;

export type UsageData = {
	inputTokens?: number;
	inputTokenDetails?: {
		noCacheTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
	outputTokens?: number;
	totalTokens?: number;
	cachedInputTokens?: number;
	cacheCreationInputTokens?: number;
	reasoningTokens?: number;
};

export type ProviderMetadata = Record<string, unknown> & {
	openai?: {
		cachedPromptTokens?: number;
		[key: string]: unknown;
	};
	anthropic?: {
		cacheCreationInputTokens?: number;
		cacheReadInputTokens?: number;
		[key: string]: unknown;
	};
};
