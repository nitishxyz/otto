import type { Hono } from 'hono';
import { logger } from '@ottocode/sdk';
import { openApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	buildWalletHeaders,
	getOttoRouterBaseUrl,
	getOttoRouterPrivateKey,
} from './service.ts';

export function registerOttoRouterBillingRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/topup/polar/estimate',
			tags: ['ottorouter'],
			operationId: 'getPolarTopupEstimate',
			summary: 'Get estimated fees for a Polar topup',
			parameters: [
				{
					in: 'query',
					name: 'amount',
					required: true,
					schema: {
						type: 'number',
					},
					description: 'Amount in USD',
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
									creditAmount: {
										type: 'number',
									},
									chargeAmount: {
										type: 'number',
									},
									feeAmount: {
										type: 'number',
									},
									feeBreakdown: {
										type: 'object',
										properties: {
											basePercent: {
												type: 'number',
											},
											internationalPercent: {
												type: 'number',
											},
											fixedCents: {
												type: 'number',
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const amount = c.req.query('amount');
				if (!amount) {
					return c.json({ error: 'Missing amount parameter' }, 400);
				}

				const baseUrl = getOttoRouterBaseUrl();
				const response = await fetch(
					`${baseUrl}/v1/topup/polar/estimate?amount=${amount}`,
					{
						method: 'GET',
						headers: { 'Content-Type': 'application/json' },
					},
				);

				const data = await response.json();
				if (!response.ok) {
					return c.json(data, response.status as 400 | 500);
				}

				return c.json(data);
			} catch (error) {
				logger.error('Failed to get Polar estimate', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/topup/polar',
			tags: ['ottorouter'],
			operationId: 'createPolarCheckout',
			summary: 'Create a Polar checkout for topping up',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								amount: {
									type: 'number',
								},
								successUrl: {
									type: 'string',
								},
							},
							required: ['amount', 'successUrl'],
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
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
			},
		},
		async (c) => {
			try {
				const privateKey = await getOttoRouterPrivateKey();
				if (!privateKey) {
					return c.json({ error: 'OttoRouter wallet not configured' }, 401);
				}

				const body = await c.req.json();
				const { amount, successUrl } = body as {
					amount: number;
					successUrl: string;
				};

				if (!amount || typeof amount !== 'number') {
					return c.json({ error: 'Invalid amount' }, 400);
				}

				if (!successUrl || typeof successUrl !== 'string') {
					return c.json({ error: 'Missing successUrl' }, 400);
				}

				const walletHeaders = buildWalletHeaders(privateKey);
				const baseUrl = getOttoRouterBaseUrl();

				const response = await fetch(`${baseUrl}/v1/topup/polar`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...walletHeaders,
					},
					body: JSON.stringify({ amount, successUrl }),
				});

				const data = await response.json();
				if (!response.ok) {
					return c.json(data, response.status as 400 | 500);
				}

				return c.json(data);
			} catch (error) {
				logger.error('Failed to create Polar checkout', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/topup/polar/status',
			tags: ['ottorouter'],
			operationId: 'getPolarTopupStatus',
			summary: 'Get status of a Polar checkout',
			parameters: [
				{
					in: 'query',
					name: 'checkoutId',
					required: true,
					schema: {
						type: 'string',
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
									checkoutId: {
										type: 'string',
									},
									confirmed: {
										type: 'boolean',
									},
									amountUsd: {
										type: 'number',
										nullable: true,
									},
									confirmedAt: {
										type: 'string',
										nullable: true,
									},
								},
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const checkoutId = c.req.query('checkoutId');
				if (!checkoutId) {
					return c.json({ error: 'Missing checkoutId parameter' }, 400);
				}

				const baseUrl = getOttoRouterBaseUrl();
				const response = await fetch(
					`${baseUrl}/v1/topup/polar/status?checkoutId=${checkoutId}`,
					{
						method: 'GET',
						headers: { 'Content-Type': 'application/json' },
					},
				);

				const data = await response.json();
				if (!response.ok) {
					return c.json(data, response.status as 400 | 500);
				}

				return c.json(data);
			} catch (error) {
				logger.error('Failed to check Polar status', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/topup/razorpay/estimate',
			tags: ['ottorouter'],
			operationId: 'getRazorpayTopupEstimate',
			summary: 'Get estimated fees for a Razorpay topup',
			parameters: [
				{
					in: 'query',
					name: 'amount',
					required: true,
					schema: {
						type: 'number',
					},
					description: 'Amount in USD',
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
									creditAmountUsd: {
										type: 'number',
									},
									chargeAmountInr: {
										type: 'number',
									},
									feeAmountInr: {
										type: 'number',
									},
									currency: {
										type: 'string',
									},
									exchangeRate: {
										type: 'number',
									},
								},
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const amount = c.req.query('amount');
				if (!amount) {
					return c.json({ error: 'Missing amount parameter' }, 400);
				}

				const baseUrl = getOttoRouterBaseUrl();
				const response = await fetch(
					`${baseUrl}/v1/topup/razorpay/estimate?amount=${amount}`,
					{
						method: 'GET',
						headers: { 'Content-Type': 'application/json' },
					},
				);

				const data = await response.json();
				if (!response.ok) {
					return c.json(data, response.status as 400 | 500);
				}

				return c.json(data);
			} catch (error) {
				logger.error('Failed to get Razorpay estimate', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/topup/razorpay',
			tags: ['ottorouter'],
			operationId: 'createRazorpayOrder',
			summary: 'Create a Razorpay order for topping up',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								amount: {
									type: 'number',
								},
							},
							required: ['amount'],
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
									},
									orderId: {
										type: 'string',
									},
									amount: {
										type: 'number',
									},
									currency: {
										type: 'string',
									},
									creditAmountUsd: {
										type: 'number',
									},
									keyId: {
										type: 'string',
									},
								},
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
			},
		},
		async (c) => {
			try {
				const privateKey = await getOttoRouterPrivateKey();
				if (!privateKey) {
					return c.json({ error: 'OttoRouter wallet not configured' }, 401);
				}

				const body = await c.req.json();
				const { amount } = body as { amount: number };

				if (!amount || typeof amount !== 'number') {
					return c.json({ error: 'Invalid amount' }, 400);
				}

				const walletHeaders = buildWalletHeaders(privateKey);
				const baseUrl = getOttoRouterBaseUrl();

				const response = await fetch(`${baseUrl}/v1/topup/razorpay`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...walletHeaders,
					},
					body: JSON.stringify({ amount }),
				});

				const data = await response.json();
				if (!response.ok) {
					return c.json(data, response.status as 400 | 500);
				}

				return c.json(data);
			} catch (error) {
				logger.error('Failed to create Razorpay order', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/topup/razorpay/verify',
			tags: ['ottorouter'],
			operationId: 'verifyRazorpayPayment',
			summary: 'Verify Razorpay payment and credit balance',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								razorpay_order_id: {
									type: 'string',
								},
								razorpay_payment_id: {
									type: 'string',
								},
								razorpay_signature: {
									type: 'string',
								},
							},
							required: [
								'razorpay_order_id',
								'razorpay_payment_id',
								'razorpay_signature',
							],
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
									},
									credited: {
										type: 'number',
									},
									newBalance: {
										type: 'number',
									},
								},
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
			},
		},
		async (c) => {
			try {
				const privateKey = await getOttoRouterPrivateKey();
				if (!privateKey) {
					return c.json({ error: 'OttoRouter wallet not configured' }, 401);
				}

				const body = await c.req.json();
				const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
					body as {
						razorpay_order_id: string;
						razorpay_payment_id: string;
						razorpay_signature: string;
					};

				if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
					return c.json({ error: 'Missing payment details' }, 400);
				}

				const walletHeaders = buildWalletHeaders(privateKey);
				const baseUrl = getOttoRouterBaseUrl();

				const response = await fetch(`${baseUrl}/v1/topup/razorpay/verify`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...walletHeaders,
					},
					body: JSON.stringify({
						razorpay_order_id,
						razorpay_payment_id,
						razorpay_signature,
					}),
				});

				const data = await response.json();
				if (!response.ok) {
					return c.json(data, response.status as 400 | 500);
				}

				return c.json(data);
			} catch (error) {
				logger.error('Failed to verify Razorpay payment', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
