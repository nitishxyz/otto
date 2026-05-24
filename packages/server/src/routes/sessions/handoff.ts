import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { createHandoffSession } from '../../runtime/session/handoff.ts';
import {
	findSessionById,
	loadProjectDb,
	normalizeSessionRow,
} from './service.ts';

export function registerSessionHandoffRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/handoff',
			tags: ['sessions'],
			operationId: 'createSessionHandoff',
			summary: 'Create a new session from current session context',
			parameters: [
				{
					in: 'path',
					name: 'sessionId',
					required: true,
					schema: { type: 'string' },
					description: 'Source session ID',
				},
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: { type: 'string' },
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			responses: {
				'201': {
					description: 'Created',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									session: { $ref: '#/components/schemas/Session' },
									sessionId: { type: 'string' },
									sourceSessionId: { type: 'string' },
									message: { type: 'string' },
								},
								required: [
									'session',
									'sessionId',
									'sourceSessionId',
									'message',
								],
							},
						},
					},
				},
				'404': {
					description: 'Session not found',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: { type: 'string' },
								},
								required: ['error'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			try {
				const sessionId = c.req.param('sessionId');
				const projectRoot = c.req.query('project') || process.cwd();
				const { cfg, db } = await loadProjectDb(projectRoot);
				const sourceSession = await findSessionById(db, sessionId);
				if (!sourceSession || sourceSession.projectPath !== cfg.projectRoot) {
					return c.json({ error: 'Session not found' }, 404);
				}

				const result = await createHandoffSession({
					cfg,
					db,
					sourceSession,
				});

				return c.json(
					{
						session: normalizeSessionRow(result.session),
						sessionId: result.session.id,
						sourceSessionId: result.sourceSessionId,
						message: result.message,
					},
					201,
				);
			} catch (err) {
				logger.error('Failed to create handoff session', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
