import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { loadProjectDb, retryAssistantMessage } from './service.ts';

export function registerSessionRetryRoutes(app: Hono) {
	// Retry a failed assistant message
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/messages/{messageId}/retry',
			tags: ['sessions'],
			operationId: 'retryMessage',
			summary: 'Retry a failed assistant message',
			parameters: [
				{
					in: 'path',
					name: 'sessionId',
					required: true,
					schema: {
						type: 'string',
					},
				},
				{
					in: 'path',
					name: 'messageId',
					required: true,
					schema: {
						type: 'string',
					},
				},
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
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
									success: {
										type: 'boolean',
									},
									messageId: {
										type: 'string',
									},
								},
								required: ['success', 'messageId'],
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
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
				'404': {
					description: 'Bad Request',
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
				const sessionId = c.req.param('sessionId');
				const messageId = c.req.param('messageId');
				const projectRoot = c.req.query('project') || process.cwd();
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
