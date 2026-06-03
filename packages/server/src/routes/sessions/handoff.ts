import { z } from '@hono/zod-openapi';
import { logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { createHandoffSession } from '../../runtime/session/handoff.ts';
import {
	findSessionById,
	loadProjectDb,
	normalizeSessionRow,
} from './service.ts';

const sessionSchema = z
	.object({
		id: z.string(),
		title: z.string().nullable(),
		agent: z.string(),
		provider: z.string(),
		model: z.string(),
		projectPath: z.string(),
		createdAt: z.number(),
		lastActiveAt: z.number().nullable(),
		lastViewedAt: z.number().nullable().optional(),
		totalInputTokens: z.number().nullable(),
		totalOutputTokens: z.number().nullable(),
		totalCachedTokens: z.number().nullable().optional(),
		totalCacheCreationTokens: z.number().nullable().optional(),
		totalToolTimeMs: z.number().nullable(),
		currentContextTokens: z.number().nullable().optional(),
		toolCounts: z.record(z.string(), z.number()).optional(),
		parentSessionId: z.string().nullable().optional(),
		branchPointMessageId: z.string().nullable().optional(),
		sessionType: z.enum(['main', 'branch', 'handoff']).optional(),
	})
	.passthrough();

const handoffParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
		description: 'Source session ID',
	}),
});

const handoffQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const handoffResponseSchema = z.object({
	session: sessionSchema,
	sessionId: z.string(),
	sourceSessionId: z.string(),
	message: z.string(),
});

const handoffErrorSchema = z.object({
	error: z.string(),
});

export function registerSessionHandoffRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/handoff',
			tags: ['sessions'],
			operationId: 'createSessionHandoff',
			summary: 'Create a new session from current session context',
			request: {
				params: handoffParamsSchema,
				query: handoffQuerySchema,
			},
			responses: {
				'201': {
					description: 'Created',
					content: {
						'application/json': { schema: handoffResponseSchema },
					},
				},
				'404': {
					description: 'Session not found',
					content: {
						'application/json': { schema: handoffErrorSchema },
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
