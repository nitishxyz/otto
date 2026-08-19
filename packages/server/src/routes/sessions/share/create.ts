import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { resolveRequestProjectRoot } from '../../project-context.ts';
import { createShare, loadProjectDb } from '../service.ts';
import {
	projectQuerySchema,
	sessionIdParamsSchema,
	shareCreateResponseSchema,
	shareErrorSchema,
} from './schemas.ts';

export function registerCreateShareRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'shareSession',
			summary: 'Share a session',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: shareCreateResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: shareErrorSchema },
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: shareErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const { sessionId } = c.req.valid('param');
			const projectRoot = await resolveRequestProjectRoot(c);
			const { db } = await loadProjectDb(projectRoot);
			const result = await createShare(db, sessionId, projectRoot);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);
}
