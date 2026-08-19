import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { sessionRepository } from '../../../runtime/session/repository.ts';
import { resolveRequestProject } from '../../project-context.ts';
import { removeSessionQueueMessage } from '../service.ts';
import {
	projectQuerySchema,
	queueErrorSchema,
	queueMessageParamsSchema,
	removeQueueResponseSchema,
} from './schemas.ts';

export function registerRemoveQueuedMessageRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/sessions/{sessionId}/queue/{messageId}',
			tags: ['sessions'],
			operationId: 'removeFromQueue',
			summary: 'Remove a message from session queue',
			request: {
				params: queueMessageParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: removeQueueResponseSchema },
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: queueErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const { sessionId, messageId } = c.req.valid('param');
			const project = await resolveRequestProject(c);
			const { db } = project;
			await sessionRepository(db, project.projectRoot).require(sessionId);
			const result = await removeSessionQueueMessage(db, sessionId, messageId);
			return result.status
				? c.json(result.body, result.status)
				: c.json(result.body);
		},
	);
}
