import { z } from '@hono/zod-openapi';
import { getPublicKeyFromPrivate, logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	getOttoRouterBalance,
	getOttoRouterBaseUrl,
	getOttoRouterPrivateKey,
	getOttoRouterWalletInfo,
} from './service.ts';

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

const ottoRouterWalletSchema = z.object({
	configured: z.boolean(),
	publicKey: z.string().optional(),
	error: z.string().optional(),
});

const usdcBalanceQuerySchema = z.object({
	network: z
		.enum(['mainnet', 'devnet'])
		.optional()
		.default('mainnet')
		.openapi({
			param: { name: 'network', in: 'query' },
			description: 'Solana network to query',
		}),
});

const usdcBalanceResponseSchema = z.object({
	walletAddress: z.string(),
	usdcBalance: z.number(),
	network: z.enum(['mainnet', 'devnet']),
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
				'Returns wallet balance, subscription, account info, limits, and usage data',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: ottoRouterBalanceSchema },
					},
				},
				'401': {
					description: 'Wallet not configured',
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
			operationId: 'getOttoRouterWallet',
			summary: 'Get OttoRouter wallet info',
			description:
				'Returns whether the wallet is configured and its public key',
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: ottoRouterWalletSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				return c.json(await getOttoRouterWalletInfo());
			} catch (error) {
				logger.error('Failed to get OttoRouter wallet info', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/usdc-balance',
			tags: ['ottorouter'],
			operationId: 'getOttoRouterUsdcBalance',
			summary: 'Get USDC token balance',
			description:
				'Fetches USDC balance from Solana blockchain for the configured wallet',
			request: { query: usdcBalanceQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: usdcBalanceResponseSchema },
					},
				},
				'401': {
					description: 'Wallet not configured',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
				'502': {
					description: 'Failed to fetch USDC balance from Solana',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const privateKey = await getOttoRouterPrivateKey();
				if (!privateKey) {
					return c.json({ error: 'OttoRouter wallet not configured' }, 401);
				}

				const publicKey = getPublicKeyFromPrivate(privateKey);
				if (!publicKey) {
					return c.json({ error: 'Invalid private key' }, 400);
				}

				const baseUrl = getOttoRouterBaseUrl();
				const response = await fetch(
					`${baseUrl}/v1/wallet/${publicKey}/balances?limit=100&showNative=false&showNfts=false&showZeroBalance=false`,
					{
						method: 'GET',
						headers: { 'Content-Type': 'application/json' },
					},
				);

				if (!response.ok) {
					return c.json({ error: 'Failed to fetch wallet balances' }, 502);
				}

				const data = (await response.json()) as {
					balances: Array<{
						mint: string;
						symbol: string;
						name: string;
						balance: number;
						decimals: number;
						pricePerToken: number | null;
						usdValue: number | null;
					}>;
					totalUsdValue: number;
				};

				const usdcEntry = data.balances.find((b) => b.symbol === 'USDC');

				return c.json({
					walletAddress: publicKey,
					usdcBalance: usdcEntry?.balance ?? 0,
					network: 'mainnet' as const,
				});
			} catch (error) {
				logger.error('Failed to fetch USDC balance', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
