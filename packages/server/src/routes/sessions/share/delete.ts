import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { sessionRepository } from '../../../runtime/session/repository.ts';
import { resolveRequestProjectRoot } from '../../project-context.ts';
import { deleteShare, loadProjectDb } from '../service.ts';
import {
	projectQuerySchema,
	sessionIdParamsSchema,
	shareDeleteResponseSchema,
	shareErrorSchema,
} from './schemas.ts';

export function registerDeleteShareRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'deleteShare',
			summary: 'Delete a shared session',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: shareDeleteResponseSchema },
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
			const { cfg, db } = await loadProjectDb(projectRoot);
			await sessionRepository(db, cfg.projectRoot).require(sessionId);
			const result = await deleteShare(db, sessionId);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);
}
