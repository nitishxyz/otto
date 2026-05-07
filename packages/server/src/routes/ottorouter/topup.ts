import type { Hono } from 'hono';
import { logger } from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import { openApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	getPendingTopup,
	rejectTopupSelection,
	resolveTopupMethodSelection,
	type TopupMethod,
} from '../../runtime/topup/manager.ts';

export function registerOttoRouterTopupRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/topup/select',
			tags: ['ottorouter'],
			operationId: 'selectTopupMethod',
			summary: 'Select topup method for pending request',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								sessionId: {
									type: 'string',
								},
								method: {
									type: 'string',
									enum: ['crypto', 'fiat'],
								},
							},
							required: ['sessionId', 'method'],
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
									method: {
										type: 'string',
									},
								},
								required: ['success', 'method'],
							},
						},
					},
				},
				'404': {
					description: 'No pending topup',
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

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/ottorouter/topup/cancel',
			tags: ['ottorouter'],
			operationId: 'cancelTopup',
			summary: 'Cancel pending topup',
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								sessionId: {
									type: 'string',
								},
								reason: {
									type: 'string',
								},
							},
							required: ['sessionId'],
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
								},
								required: ['success'],
							},
						},
					},
				},
				'404': {
					description: 'No pending topup',
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

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/ottorouter/topup/pending',
			tags: ['ottorouter'],
			operationId: 'getPendingTopup',
			summary: 'Get pending topup for a session',
			parameters: [
				{
					in: 'query',
					name: 'sessionId',
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
									hasPending: {
										type: 'boolean',
									},
									sessionId: {
										type: 'string',
									},
									messageId: {
										type: 'string',
									},
									amountUsd: {
										type: 'number',
									},
									currentBalance: {
										type: 'number',
									},
									createdAt: {
										type: 'integer',
									},
								},
								required: ['hasPending'],
							},
						},
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
