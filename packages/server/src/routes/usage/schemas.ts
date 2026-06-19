import { z } from '@hono/zod-openapi';

export const usageStatsQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const usageAuthAmountSchema = z.object({
	oauth: z.number(),
	api: z.number(),
	subscription: z.number(),
});

const usageAuthCountSchema = z.object({
	oauth: z.number().int(),
	api: z.number().int(),
	subscription: z.number().int(),
});

const usageTotalsSchema = z.object({
	messages: z.number().int(),
	sessions: z.number().int(),
	inputTokens: z.number().int(),
	outputTokens: z.number().int(),
	cachedInputTokens: z.number().int(),
	cacheCreationInputTokens: z.number().int(),
	reasoningTokens: z.number().int(),
	costUsd: z.number(),
	notionalCostUsd: z.number(),
	savedUsd: z.number(),
	costByAuth: usageAuthAmountSchema,
	messagesByAuth: usageAuthCountSchema,
});

const usageAuthTypeSchema = z.enum([
	'oauth',
	'api',
	'wallet',
	'subscription',
	'unknown',
]);

const usageProviderAggSchema = z.object({
	provider: z.string(),
	authType: usageAuthTypeSchema,
	messages: z.number().int(),
	sessions: z.number().int(),
	inputTokens: z.number().int(),
	outputTokens: z.number().int(),
	cachedInputTokens: z.number().int(),
	cacheCreationInputTokens: z.number().int(),
	reasoningTokens: z.number().int(),
	costUsd: z.number(),
	notionalCostUsd: z.number(),
});

const usageModelAggSchema = z.object({
	provider: z.string(),
	model: z.string(),
	authType: usageAuthTypeSchema,
	messages: z.number().int(),
	inputTokens: z.number().int(),
	outputTokens: z.number().int(),
	cachedInputTokens: z.number().int(),
	cacheCreationInputTokens: z.number().int(),
	reasoningTokens: z.number().int(),
	costUsd: z.number(),
	notionalCostUsd: z.number(),
});

const usageDailyAggSchema = z.object({
	date: z.string(),
	messages: z.number().int(),
	inputTokens: z.number().int(),
	outputTokens: z.number().int(),
	costUsd: z.number(),
	notionalCostUsd: z.number(),
	costByAuth: usageAuthAmountSchema,
	notionalByAuth: usageAuthAmountSchema,
});

const usageProjectsBreakdownSchema = z.object({
	included: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			path: z.string(),
			lastSeenAt: z.number().int(),
			messages: z.number().int(),
			notionalCostUsd: z.number(),
		}),
	),
	unavailable: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			path: z.string(),
			reason: z.string(),
		}),
	),
});

export const usageStatsResponseSchema = z
	.object({
		scope: z.enum(['project', 'global']),
		project: z.string(),
		generatedAt: z.number().int(),
		totals: usageTotalsSchema,
		providers: z.array(usageProviderAggSchema),
		models: z.array(usageModelAggSchema),
		daily: z.array(usageDailyAggSchema),
		notes: z.object({
			oauthProviders: z.array(z.string()),
			subscriptionProviders: z.array(z.string()),
			missingPricing: z.array(z.string()),
		}),
		projects: usageProjectsBreakdownSchema.optional(),
	})
	.openapi('UsageStats');
