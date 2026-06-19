import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { loadProjectDb, syncShare } from '../service.ts';
import {
	projectQuerySchema,
	sessionIdParamsSchema,
	shareErrorSchema,
	shareSyncResponseSchema,
} from './schemas.ts';

export function registerSyncShareRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'syncShare',
			summary: 'Sync shared session with new messages',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: shareSyncResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: shareErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const sessionId = c.req.param('sessionId');
			const projectRoot = c.req.query('project') || process.cwd();
			const { db } = await loadProjectDb(projectRoot);
			const result = await syncShare(db, sessionId);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);
}
