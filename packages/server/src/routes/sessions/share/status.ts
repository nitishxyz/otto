import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { getShareStatus, loadProjectDb } from '../service.ts';
import {
	projectQuerySchema,
	sessionIdParamsSchema,
	shareStatusSchema,
} from './schemas.ts';

export function registerShareStatusRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'getShareStatus',
			summary: 'Get share status for a session',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: shareStatusSchema },
					},
				},
			},
		},
		async (c) => {
			const sessionId = c.req.param('sessionId');
			const projectRoot = c.req.query('project') || process.cwd();
			const { db } = await loadProjectDb(projectRoot);
			return c.json(await getShareStatus(db, sessionId));
		},
	);
}
