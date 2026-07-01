import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { loadProjectDb, retryAssistantMessage } from './service.ts';

const retryMessageParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
	messageId: z.string().openapi({
		param: { name: 'messageId', in: 'path' },
	}),
});

const retryMessageQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const retryMessageResponseSchema = z.object({
	success: z.boolean(),
	messageId: z.string(),
});

const retryMessageErrorSchema = z.object({
	error: z.string(),
});

export function registerSessionRetryRoutes(app: Hono) {
	// Retry a failed assistant message
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/messages/{messageId}/retry',
			tags: ['sessions'],
			operationId: 'retryMessage',
			summary: 'Retry a failed assistant message',
			request: {
				params: retryMessageParamsSchema,
				query: retryMessageQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: retryMessageResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: retryMessageErrorSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: {
						'application/json': { schema: retryMessageErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const sessionId = c.req.param('sessionId');
				const messageId = c.req.param('messageId');
				const projectRoot = await resolveRequestProjectRoot(c);
				const { cfg, db } = await loadProjectDb(projectRoot);
				const result = await retryAssistantMessage(
					cfg,
					db,
					sessionId,
					messageId,
				);
				return result.ok
					? c.json(result.body)
					: c.json(result.body, result.status);
			} catch (err) {
				logger.error('Failed to retry message', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
