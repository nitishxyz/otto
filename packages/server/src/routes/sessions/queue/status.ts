import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { getSessionQueueState } from '../service.ts';
import { queueStateSchema, sessionIdParamsSchema } from './schemas.ts';

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
			const sessionId = c.req.param('sessionId');
			return c.json(getSessionQueueState(sessionId));
		},
	);
}
