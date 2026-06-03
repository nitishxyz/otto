import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { publish } from '../../events/bus.ts';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	getPendingTopup,
	rejectTopupSelection,
	resolveTopupMethodSelection,
	type TopupMethod,
} from '../../runtime/topup/manager.ts';

const topupMethodSchema = z.enum(['crypto', 'fiat']);

const selectTopupBodySchema = z.object({
	sessionId: z.string(),
	method: topupMethodSchema,
});

const cancelTopupBodySchema = z.object({
	sessionId: z.string(),
	reason: z.string().optional(),
});

const pendingTopupQuerySchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'query' },
	}),
});

const selectTopupResponseSchema = z.object({
	success: z.boolean(),
	method: topupMethodSchema,
});

const successResponseSchema = z.object({
	success: z.boolean(),
});

const pendingTopupResponseSchema = z.object({
	hasPending: z.boolean(),
	sessionId: z.string().optional(),
	messageId: z.string().optional(),
	amountUsd: z.number().optional(),
	currentBalance: z.number().optional(),
	createdAt: z.number().int().optional(),
});

const topupErrorSchema = z.object({
	error: z.string(),
});

export function registerOttoRouterTopupRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/topup/select',
			tags: ['ottorouter'],
			operationId: 'selectTopupMethod',
			summary: 'Select topup method for pending request',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: selectTopupBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: selectTopupResponseSchema },
					},
				},
				'404': {
					description: 'No pending topup',
					content: {
						'application/json': { schema: topupErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const body = await c.req.json();
				const { sessionId, method } = body as {
					sessionId: string;
					method: TopupMethod;
				};

				if (!sessionId || typeof sessionId !== 'string') {
					return c.json({ error: 'Missing sessionId' }, 400);
				}

				if (!method || !['crypto', 'fiat'].includes(method)) {
					return c.json(
						{ error: 'Invalid method, must be "crypto" or "fiat"' },
						400,
					);
				}

				const resolved = resolveTopupMethodSelection(sessionId, method);
				if (!resolved) {
					return c.json(
						{ error: 'No pending topup request found for this session' },
						404,
					);
				}

				publish({
					type: 'ottorouter.topup.method_selected',
					sessionId,
					payload: { method },
				});

				return c.json({ success: true, method });
			} catch (error) {
				logger.error('Failed to select topup method', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/topup/cancel',
			tags: ['ottorouter'],
			operationId: 'cancelTopup',
			summary: 'Cancel pending topup',
			request: {
				body: {
					required: true,
					content: {
						'application/json': { schema: cancelTopupBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: successResponseSchema },
					},
				},
				'404': {
					description: 'No pending topup',
					content: {
						'application/json': { schema: topupErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const body = await c.req.json();
				const { sessionId, reason } = body as {
					sessionId: string;
					reason?: string;
				};

				if (!sessionId || typeof sessionId !== 'string') {
					return c.json({ error: 'Missing sessionId' }, 400);
				}

				const rejected = rejectTopupSelection(
					sessionId,
					reason ?? 'User cancelled',
				);
				if (!rejected) {
					return c.json(
						{ error: 'No pending topup request found for this session' },
						404,
					);
				}

				publish({
					type: 'ottorouter.topup.cancelled',
					sessionId,
					payload: { reason: reason ?? 'User cancelled' },
				});

				return c.json({ success: true });
			} catch (error) {
				logger.error('Failed to cancel topup', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/topup/pending',
			tags: ['ottorouter'],
			operationId: 'getPendingTopup',
			summary: 'Get pending topup for a session',
			request: {
				query: pendingTopupQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: pendingTopupResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const sessionId = c.req.query('sessionId');
				if (!sessionId) {
					return c.json({ error: 'Missing sessionId parameter' }, 400);
				}

				const pending = getPendingTopup(sessionId);
				if (!pending) {
					return c.json({ hasPending: false });
				}

				return c.json({
					hasPending: true,
					sessionId: pending.sessionId,
					messageId: pending.messageId,
					amountUsd: pending.amountUsd,
					currentBalance: pending.currentBalance,
					createdAt: pending.createdAt,
				});
			} catch (error) {
				logger.error('Failed to get pending topup', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
