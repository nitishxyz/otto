import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { getOttoRouterAuthInfo, getOttoRouterBalance } from './service.ts';

const errorResponseSchema = z.object({ error: z.string() });

const nullableNumberSchema = z.number().nullable();

const ottoRouterBalanceSchema = z.object({
	walletAddress: z.string(),
	balance: z.number(),
	totalSpent: z.number(),
	totalTopups: z.number(),
	requestCount: z.number(),
	scope: z.enum(['wallet', 'account']).optional(),
	payg: z
		.object({
			walletBalanceUsd: z.number().optional(),
			accountBalanceUsd: z.number().optional(),
			rawPoolUsd: z.number().optional(),
			effectiveSpendableUsd: z.number().optional(),
		})
		.optional(),
	limits: z
		.object({
			enabled: z.boolean().optional(),
			dailyLimitUsd: nullableNumberSchema.optional(),
			dailySpentUsd: z.number().optional(),
			dailyRemainingUsd: nullableNumberSchema.optional(),
			monthlyLimitUsd: nullableNumberSchema.optional(),
			monthlySpentUsd: z.number().optional(),
			monthlyRemainingUsd: nullableNumberSchema.optional(),
			capRemainingUsd: nullableNumberSchema.optional(),
		})
		.nullable()
		.optional(),
	subscription: z
		.object({
			active: z.boolean().optional(),
			tierId: z.string().optional(),
			tierName: z.string().optional(),
			creditsIncluded: z.number().optional(),
			creditsUsed: z.number().optional(),
			creditsRemaining: z.number().optional(),
			periodStart: z.string().optional(),
			periodEnd: z.string().optional(),
		})
		.nullable()
		.optional(),
});

const ottoRouterAuthSchema = z.object({
	configured: z.boolean(),
	expiresAt: z.number().optional(),
	error: z.string().optional(),
});

export function registerOttoRouterWalletRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/balance',
			tags: ['ottorouter'],
			operationId: 'getOttoRouterBalance',
			summary: 'Get OttoRouter account balance',
			description:
				'Returns account balance, subscription, limits, and usage data for the OAuth account',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: ottoRouterBalanceSchema },
					},
				},
				'401': {
					description: 'OAuth not configured',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
				'502': {
					description: 'Failed to fetch balance from OttoRouter',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const result = await getOttoRouterBalance();
				return result.ok
					? c.json(result.body)
					: c.json(result.body, result.status);
			} catch (error) {
				logger.error('Failed to fetch OttoRouter balance', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/wallet',
			tags: ['ottorouter'],
			operationId: 'getOttoRouterAuth',
			summary: 'Get OttoRouter OAuth status',
			description:
				'Returns whether OttoRouter OAuth is configured for this otto instance',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: ottoRouterAuthSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				return c.json(await getOttoRouterAuthInfo());
			} catch (error) {
				logger.error('Failed to get OttoRouter OAuth status', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
