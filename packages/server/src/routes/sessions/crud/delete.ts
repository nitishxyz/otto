import { sessions } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { serializeError } from '../../../runtime/errors/api-error.ts';
import { resolveRequestProject } from '../../project-context.ts';
import { deleteSessionMessagesAndParts, findSessionById } from '../service.ts';
import {
	errorResponseSchema,
	sessionParamsSchema,
	sessionProjectQuerySchema,
	successResponseSchema,
} from './schemas.ts';

export function registerDeleteSessionRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/sessions/{sessionId}',
			tags: ['sessions'],
			operationId: 'deleteSession',
			summary: 'Delete a session',
			request: {
				params: sessionParamsSchema,
				query: sessionProjectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: successResponseSchema } },
				},
				'404': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { sessionId } = c.req.valid('param');
				const { cfg, db } = await resolveRequestProject(c);

				const existingSession = await findSessionById(
					db,
					sessionId,
					cfg.projectRoot,
				);

				if (!existingSession) {
					return c.json({ error: 'Session not found' }, 404);
				}

				if (existingSession.projectPath !== cfg.projectRoot) {
					return c.json({ error: 'Session not found in this project' }, 404);
				}

				await deleteSessionMessagesAndParts(db, sessionId);
				await db.delete(sessions).where(eq(sessions.id, sessionId));

				return c.json({ success: true });
			} catch (err) {
				logger.error('Failed to delete session', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
