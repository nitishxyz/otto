import { sessions } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { serializeError } from '../../../runtime/errors/api-error.ts';
import {
	attachSessionCostSummary,
	buildSessionPreferenceUpdates,
	findSessionById,
	getSessionCostSummaries,
	loadProjectDb,
	normalizeSessionRow,
} from '../service.ts';
import {
	errorResponseSchema,
	sessionParamsSchema,
	sessionProjectQuerySchema,
	sessionSchema,
	updateSessionBodySchema,
} from './schemas.ts';

export function registerUpdateSessionRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'patch',
			path: '/v1/sessions/{sessionId}',
			tags: ['sessions'],
			operationId: 'updateSession',
			summary: 'Update session preferences',
			request: {
				params: sessionParamsSchema,
				query: sessionProjectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: updateSessionBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: sessionSchema } },
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
				'404': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			try {
				const sessionId = c.req.param('sessionId');
				const projectRoot = c.req.query('project') || process.cwd();
				const { cfg, db } = await loadProjectDb(projectRoot);

				const body = (await c.req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;

				const existingSession = await findSessionById(db, sessionId);

				if (!existingSession) {
					return c.json({ error: 'Session not found' }, 404);
				}

				if (existingSession.projectPath !== cfg.projectRoot) {
					return c.json({ error: 'Session not found in this project' }, 404);
				}

				const updateResult = await buildSessionPreferenceUpdates(
					cfg,
					existingSession,
					body,
				);
				if (!updateResult.ok) {
					return c.json({ error: updateResult.error }, updateResult.status);
				}

				if (Object.keys(updateResult.updates).length > 0) {
					await db
						.update(sessions)
						.set(updateResult.updates)
						.where(eq(sessions.id, sessionId));
				}

				const updatedRows = await db
					.select()
					.from(sessions)
					.where(eq(sessions.id, sessionId))
					.limit(1);

				const responseSession = updatedRows[0] ?? existingSession;
				const costSummaries = await getSessionCostSummaries(db, [
					responseSession,
				]);
				return c.json(
					attachSessionCostSummary(
						normalizeSessionRow(responseSession),
						costSummaries.get(responseSession.id),
					),
				);
			} catch (err) {
				logger.error('Failed to update session', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
