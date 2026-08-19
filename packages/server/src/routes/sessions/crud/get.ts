import { logger } from '@ottocode/sdk';
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
	errorResponseSchema,
	sessionParamsSchema,
	sessionProjectQuerySchema,
	sessionSchema,
} from './schemas.ts';

export function registerGetSessionRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}',
			tags: ['sessions'],
			operationId: 'getSession',
			summary: 'Get a single session by ID',
			request: {
				params: sessionParamsSchema,
				query: sessionProjectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: sessionSchema } },
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
				const { db, projectRoot } = await resolveRequestProject(c);
				const session = await findSessionById(db, sessionId, projectRoot);
				if (!session) {
					return c.json(
						{ error: { message: 'Session not found', status: 404 } },
						404,
					);
				}
				const costSummaries = await getSessionCostSummaries(db, [session]);
				return c.json(
					attachSessionCostSummary(
						normalizeSessionRow(session),
						costSummaries.get(session.id),
					),
				);
			} catch (err) {
				logger.error('Failed to get session', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
