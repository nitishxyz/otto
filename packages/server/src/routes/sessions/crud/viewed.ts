import { sessions } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { serializeError } from '../../../runtime/errors/api-error.ts';
import { resolveRequestProject } from '../../project-context.ts';
import {
	attachSessionCostSummary,
	findSessionById,
	getSessionCostSummaries,
	normalizeSessionRow,
} from '../service.ts';
import {
	sessionParamsSchema,
	sessionProjectQuerySchema,
	sessionSchema,
} from './schemas.ts';

export function registerMarkSessionViewedRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/viewed',
			tags: ['sessions'],
			operationId: 'markSessionViewed',
			summary: 'Mark a session as viewed',
			request: {
				params: sessionParamsSchema,
				query: sessionProjectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: sessionSchema } },
				},
				'404': { description: 'Not Found' },
			},
		},
		async (c) => {
			try {
				const sessionId = c.req.param('sessionId');
				const { cfg, db } = await resolveRequestProject(c);
				const existingSession = await findSessionById(db, sessionId);
				if (
					!existingSession ||
					existingSession.projectPath !== cfg.projectRoot
				) {
					return c.json({ error: 'Session not found' }, 404);
				}

				await db
					.update(sessions)
					.set({ lastViewedAt: Date.now() })
					.where(eq(sessions.id, sessionId));

				const updatedSession = await findSessionById(db, sessionId);
				const sessionForResponse = updatedSession ?? existingSession;
				const costSummaries = await getSessionCostSummaries(db, [
					sessionForResponse,
				]);
				return c.json(
					attachSessionCostSummary(
						normalizeSessionRow(sessionForResponse, {
							includeRunning: true,
						}),
						costSummaries.get(sessionForResponse.id),
					),
				);
			} catch (err) {
				logger.error('Failed to mark session viewed', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
