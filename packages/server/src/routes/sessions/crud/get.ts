import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { serializeError } from '../../../runtime/errors/api-error.ts';
import {
	attachSessionCostSummary,
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
				const sessionId = c.req.param('sessionId');
				const projectRoot = c.req.query('project') || process.cwd();
				const { db } = await loadProjectDb(projectRoot);
				const session = await findSessionById(db, sessionId);
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
