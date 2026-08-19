import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { sessionRepository } from '../../../runtime/session/repository.ts';
import { resolveRequestProject } from '../../project-context.ts';
import { getSessionQueueState } from '../service.ts';
import {
	projectQuerySchema,
	queueStateSchema,
	sessionIdParamsSchema,
} from './schemas.ts';

export function registerSessionQueueStatusRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/queue',
			tags: ['sessions'],
			operationId: 'getSessionQueue',
			summary: 'Get queue state for a session',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: queueStateSchema },
					},
				},
			},
		},
		async (c) => {
			const project = await resolveRequestProject(c);
			const { sessionId } = c.req.valid('param');
			await sessionRepository(project.db, project.projectRoot).require(
				sessionId,
			);
			return c.json(getSessionQueueState(sessionId));
		},
	);
}
