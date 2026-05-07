import type { Hono } from 'hono';
import { getPublicKeyFromPrivate, logger } from '@ottocode/sdk';
import { openApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	getOttoRouterBalance,
	getOttoRouterBaseUrl,
	getOttoRouterPrivateKey,
	getOttoRouterWalletInfo,
} from './service.ts';

export function registerOttoRouterWalletRoutes(app: Hono) {
	openApiRoute(
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
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									walletAddress: {
										type: 'string',
									},
									balance: {
										type: 'number',
									},
									totalSpent: {
										type: 'number',
									},
									totalTopups: {
										type: 'number',
									},
									requestCount: {
										type: 'number',
									},
									scope: {
										type: 'string',
										enum: ['wallet', 'account'],
									},
									payg: {
										type: 'object',
										properties: {
											walletBalanceUsd: {
												type: 'number',
											},
											accountBalanceUsd: {
												type: 'number',
											},
											rawPoolUsd: {
												type: 'number',
											},
											effectiveSpendableUsd: {
												type: 'number',
											},
										},
									},
									limits: {
										type: 'object',
										nullable: true,
										properties: {
											enabled: {
												type: 'boolean',
											},
											dailyLimitUsd: {
												type: 'number',
												nullable: true,
											},
											dailySpentUsd: {
												type: 'number',
											},
											dailyRemainingUsd: {
												type: 'number',
												nullable: true,
											},
											monthlyLimitUsd: {
												type: 'number',
												nullable: true,
											},
											monthlySpentUsd: {
												type: 'number',
											},
											monthlyRemainingUsd: {
												type: 'number',
												nullable: true,
											},
											capRemainingUsd: {
												type: 'number',
												nullable: true,
											},
										},
									},
									subscription: {
										type: 'object',
										nullable: true,
										properties: {
											active: {
												type: 'boolean',
											},
											tierId: {
												type: 'string',
											},
											tierName: {
												type: 'string',
											},
											creditsIncluded: {
												type: 'number',
											},
											creditsUsed: {
												type: 'number',
											},
											creditsRemaining: {
												type: 'number',
											},
											periodStart: {
												type: 'string',
											},
											periodEnd: {
												type: 'string',
											},
										},
									},
								},
								required: [
									'walletAddress',
									'balance',
									'totalSpent',
									'totalTopups',
									'requestCount',
								],
							},
						},
					},
				},
				'401': {
					description: 'Wallet not configured',
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
				'502': {
					description: 'Failed to fetch balance from OttoRouter',
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

	openApiRoute(
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
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									configured: {
										type: 'boolean',
									},
									publicKey: {
										type: 'string',
									},
									error: {
										type: 'string',
									},
								},
								required: ['configured'],
							},
						},
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

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/usdc-balance',
			tags: ['ottorouter'],
			operationId: 'getOttoRouterUsdcBalance',
			summary: 'Get USDC token balance',
			description:
				'Fetches USDC balance from Solana blockchain for the configured wallet',
			parameters: [
				{
					in: 'query',
					name: 'network',
					schema: {
						type: 'string',
						enum: ['mainnet', 'devnet'],
						default: 'mainnet',
					},
					description: 'Solana network to query',
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
									walletAddress: {
										type: 'string',
									},
									usdcBalance: {
										type: 'number',
									},
									network: {
										type: 'string',
										enum: ['mainnet', 'devnet'],
									},
								},
								required: ['walletAddress', 'usdcBalance', 'network'],
							},
						},
					},
				},
				'401': {
					description: 'Wallet not configured',
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
				'502': {
					description: 'Failed to fetch USDC balance from Solana',
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
