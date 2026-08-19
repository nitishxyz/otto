import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { fetchWithOttoRouterAuth, getOttoRouterBaseUrl } from './service.ts';

const errorResponseSchema = z.object({ error: z.string() });
const passthroughResponseSchema = z.record(z.string(), z.unknown());

const amountQuerySchema = z.object({
	amount: z.coerce.number().openapi({
		param: { name: 'amount', in: 'query' },
		description: 'Amount in USD',
	}),
});

const polarEstimateSchema = z.object({
	creditAmount: z.number().optional(),
	chargeAmount: z.number().optional(),
	feeAmount: z.number().optional(),
	feeBreakdown: z
		.object({
			basePercent: z.number().optional(),
			internationalPercent: z.number().optional(),
			fixedCents: z.number().optional(),
		})
		.optional(),
});

const polarCheckoutBodySchema = z.object({
	amount: z.number(),
	successUrl: z.string(),
});

const polarStatusQuerySchema = z.object({
	checkoutId: z.string().openapi({
		param: { name: 'checkoutId', in: 'query' },
	}),
});

const polarStatusSchema = z.object({
	checkoutId: z.string().optional(),
	confirmed: z.boolean().optional(),
	amountUsd: z.number().nullable().optional(),
	confirmedAt: z.string().nullable().optional(),
});

const razorpayEstimateSchema = z.object({
	creditAmountUsd: z.number().optional(),
	chargeAmountInr: z.number().optional(),
	feeAmountInr: z.number().optional(),
	currency: z.string().optional(),
	exchangeRate: z.number().optional(),
});

const razorpayOrderBodySchema = z.object({ amount: z.number() });

const razorpayOrderResponseSchema = z.object({
	success: z.boolean().optional(),
	orderId: z.string().optional(),
	amount: z.number().optional(),
	currency: z.string().optional(),
	creditAmountUsd: z.number().optional(),
	keyId: z.string().optional(),
});

const razorpayVerifyBodySchema = z.object({
	razorpay_order_id: z.string(),
	razorpay_payment_id: z.string(),
	razorpay_signature: z.string(),
});

const razorpayVerifyResponseSchema = z.object({
	success: z.boolean().optional(),
	credited: z.number().optional(),
	newBalance: z.number().optional(),
});

export function registerOttoRouterBillingRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/topup/polar/estimate',
			tags: ['ottorouter'],
			operationId: 'getPolarTopupEstimate',
			summary: 'Get estimated fees for a Polar topup',
			request: { query: amountQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: polarEstimateSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { amount } = c.req.valid('query');
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

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/topup/polar',
			tags: ['ottorouter'],
			operationId: 'createPolarCheckout',
			summary: 'Create a Polar checkout for topping up',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: polarCheckoutBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: passthroughResponseSchema },
					},
				},
				'401': {
					description: 'OAuth not configured',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const body = c.req.valid('json');
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

				const baseUrl = getOttoRouterBaseUrl();

				const response = await fetchWithOttoRouterAuth(
					`${baseUrl}/v1/topup/polar`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({ amount, successUrl }),
					},
				);
				if (!response) {
					return c.json({ error: 'OttoRouter OAuth not configured' }, 401);
				}

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

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/topup/polar/status',
			tags: ['ottorouter'],
			operationId: 'getPolarTopupStatus',
			summary: 'Get status of a Polar checkout',
			request: { query: polarStatusQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: polarStatusSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { checkoutId } = c.req.valid('query');
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

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/topup/razorpay/estimate',
			tags: ['ottorouter'],
			operationId: 'getRazorpayTopupEstimate',
			summary: 'Get estimated fees for a Razorpay topup',
			request: { query: amountQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: razorpayEstimateSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { amount } = c.req.valid('query');
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

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/topup/razorpay',
			tags: ['ottorouter'],
			operationId: 'createRazorpayOrder',
			summary: 'Create a Razorpay order for topping up',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: razorpayOrderBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: razorpayOrderResponseSchema },
					},
				},
				'401': {
					description: 'OAuth not configured',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const body = c.req.valid('json');
				const { amount } = body as { amount: number };

				if (!amount || typeof amount !== 'number') {
					return c.json({ error: 'Invalid amount' }, 400);
				}

				const baseUrl = getOttoRouterBaseUrl();

				const response = await fetchWithOttoRouterAuth(
					`${baseUrl}/v1/topup/razorpay`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({ amount }),
					},
				);
				if (!response) {
					return c.json({ error: 'OttoRouter OAuth not configured' }, 401);
				}

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

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/topup/razorpay/verify',
			tags: ['ottorouter'],
			operationId: 'verifyRazorpayPayment',
			summary: 'Verify Razorpay payment and credit balance',
			request: {
				body: {
					required: true,
					content: { 'application/json': { schema: razorpayVerifyBodySchema } },
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: razorpayVerifyResponseSchema },
					},
				},
				'401': {
					description: 'OAuth not configured',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const body = c.req.valid('json');
				const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
					body as {
						razorpay_order_id: string;
						razorpay_payment_id: string;
						razorpay_signature: string;
					};

				if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
					return c.json({ error: 'Missing payment details' }, 400);
				}

				const baseUrl = getOttoRouterBaseUrl();

				const response = await fetchWithOttoRouterAuth(
					`${baseUrl}/v1/topup/razorpay/verify`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							razorpay_order_id,
							razorpay_payment_id,
							razorpay_signature,
						}),
					},
				);
				if (!response) {
					return c.json({ error: 'OttoRouter OAuth not configured' }, 401);
				}

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
