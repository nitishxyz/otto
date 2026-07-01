import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	sessionFilesErrorSchema,
	sessionFilesParamsSchema,
	sessionFilesQuerySchema,
	sessionFilesResponseSchema,
} from './schemas.ts';
import { getSessionFiles } from './service.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';

export function registerSessionFilesRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/files',
			tags: ['sessions'],
			operationId: 'getSessionFiles',
			summary: 'Get files modified in a session',
			request: {
				params: sessionFilesParamsSchema,
				query: sessionFilesQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: sessionFilesResponseSchema },
					},
				},
				'404': {
					description: 'Session not found',
					content: {
						'application/json': { schema: sessionFilesErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const sessionId = c.req.param('sessionId');
				const projectRoot = await resolveRequestProjectRoot(c);
				return c.json(await getSessionFiles(sessionId, projectRoot));
			} catch (error) {
				if (
					error instanceof Error &&
					'status' in error &&
					error.status === 404
				) {
					return c.json({ error: error.message }, 404);
				}
				logger.error('Failed to get session files', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
