import { z } from '@hono/zod-openapi';
import { sessions } from '@ottocode/database/schema';
import { hasConfiguredProvider, logger, type ProviderId } from '@ottocode/sdk';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { resolveAgentConfig } from '../../runtime/agent/registry.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { createSession as createSessionRow } from '../../runtime/session/manager.ts';
import {
	buildSessionPreferenceUpdates,
	deleteSessionMessagesAndParts,
	findSessionById,
	getSessionFileStats,
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
		pinnedAt: z.number().nullable().optional(),
		totalInputTokens: z.number().nullable(),
		totalOutputTokens: z.number().nullable(),
		totalCachedTokens: z.number().nullable().optional(),
		totalCacheCreationTokens: z.number().nullable().optional(),
		totalReasoningTokens: z.number().nullable().optional(),
		totalToolTimeMs: z.number().nullable(),
		currentContextTokens: z.number().nullable().optional(),
		contextSummary: z.string().nullable().optional(),
		lastCompactedAt: z.number().nullable().optional(),
		parentSessionId: z.string().nullable().optional(),
		branchPointMessageId: z.string().nullable().optional(),
		sessionType: z.enum(['main', 'branch', 'handoff', 'btw']).optional(),
		toolCounts: z.record(z.string(), z.number()).optional(),
		isRunning: z.boolean().optional(),
		fileStats: z
			.object({
				changedFiles: z.number(),
				additions: z.number(),
				deletions: z.number(),
				operations: z.number(),
			})
			.optional(),
	})
	.passthrough();

const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

const listSessionsQuerySchema = projectQuerySchema.extend({
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(200)
		.optional()
		.default(50)
		.openapi({
			param: { name: 'limit', in: 'query' },
			description: 'Maximum number of sessions to return',
		}),
	offset: z.coerce
		.number()
		.int()
		.min(0)
		.optional()
		.default(0)
		.openapi({
			param: { name: 'offset', in: 'query' },
			description: 'Offset for pagination',
		}),
});

const sessionParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
});

const sessionProjectQuerySchema = projectQuerySchema;

const createSessionBodySchema = z.object({
	title: z.string().nullable().optional(),
	agent: z.string().optional().openapi({
		description:
			'Agent name. Defaults to config. Agent provider/model overrides are used when provider/model are omitted.',
	}),
	provider: z.string().optional().openapi({
		description:
			'Provider override. If omitted, selected agent provider override, then config default are used.',
	}),
	model: z.string().optional().openapi({
		description:
			'Model override. If omitted, selected agent model override, then config default are used.',
	}),
	parentSessionId: z.string().nullable().optional(),
	sessionType: z.enum(['main', 'btw']).optional(),
});

const updateSessionBodySchema = z.object({
	title: z.string().optional(),
	agent: z.string().optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
	isPinned: z.boolean().optional(),
});

const errorResponseSchema = z.object({ error: z.string() });
const successResponseSchema = z.object({ success: z.boolean() });

export function registerSessionCrudRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions',
			tags: ['sessions'],
			operationId: 'listSessions',
			summary: 'List sessions',
			request: { query: listSessionsQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: z.object({
								items: z.array(sessionSchema),
								hasMore: z.boolean(),
								nextOffset: z.number().int().nullable(),
							}),
						},
					},
				},
			},
		},
		async (c) => {
			const projectRoot = c.req.query('project') || process.cwd();
			const limit = Math.min(
				Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1),
				200,
			);
			const offset = Math.max(
				parseInt(c.req.query('offset') || '0', 10) || 0,
				0,
			);
			const { cfg, db } = await loadProjectDb(projectRoot);
			const rows = await db
				.select()
				.from(sessions)
				.where(
					and(
						eq(sessions.projectPath, cfg.projectRoot),
						ne(sessions.sessionType, 'research'),
						ne(sessions.sessionType, 'btw'),
					),
				)
				.orderBy(
					desc(sql`${sessions.pinnedAt} IS NOT NULL`),
					desc(sessions.lastActiveAt),
					desc(sessions.createdAt),
				)
				.limit(limit + 1)
				.offset(offset);
			const hasMore = rows.length > limit;
			const page = hasMore ? rows.slice(0, limit) : rows;
			const fileStats = await getSessionFileStats(db, page);
			const normalized = page.map((r) => {
				const normalizedSession = normalizeSessionRow(r, {
					includeRunning: true,
				});
				const stats = fileStats.get(r.id);
				return stats && stats.changedFiles > 0
					? { ...normalizedSession, fileStats: stats }
					: normalizedSession;
			});
			return c.json({
				items: normalized,
				hasMore,
				nextOffset: hasMore ? offset + limit : null,
			});
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions',
			tags: ['sessions'],
			operationId: 'createSession',
			summary: 'Create a new session',
			request: {
				query: projectQuerySchema,
				body: {
					required: false,
					content: {
						'application/json': { schema: createSessionBodySchema },
					},
				},
			},
			responses: {
				'201': {
					description: 'Created',
					content: { 'application/json': { schema: sessionSchema } },
				},
				'400': {
					description: 'Bad Request',
					content: { 'application/json': { schema: errorResponseSchema } },
				},
			},
		},
		async (c) => {
			const projectRoot = c.req.query('project') || process.cwd();
			const { cfg, db } = await loadProjectDb(projectRoot);
			const body = (await c.req.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			const agent = (body.agent as string | undefined) ?? cfg.defaults.agent;
			const agentCfg = await resolveAgentConfig(cfg.projectRoot, agent);
			const providerCandidate =
				typeof body.provider === 'string' ? body.provider : undefined;
			const provider: ProviderId = (() => {
				if (providerCandidate && hasConfiguredProvider(cfg, providerCandidate))
					return providerCandidate;
				if (hasConfiguredProvider(cfg, agentCfg.provider))
					return agentCfg.provider;
				return cfg.defaults.provider;
			})();
			const modelCandidate =
				typeof body.model === 'string' ? body.model.trim() : undefined;
			const model = modelCandidate?.length
				? modelCandidate
				: (agentCfg.model ?? cfg.defaults.model);
			try {
				const row = await createSessionRow({
					db,
					cfg,
					agent,
					provider,
					model,
					title: (body.title as string | null | undefined) ?? null,
					parentSessionId:
						(body.parentSessionId as string | null | undefined) ?? null,
					sessionType: body.sessionType === 'btw' ? 'btw' : 'main',
				});
				return c.json(row, 201);
			} catch (err) {
				logger.error('Failed to create session', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 400);
			}
		},
	);

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
				return c.json(normalizeSessionRow(session));
			} catch (err) {
				logger.error('Failed to get session', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

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
				const projectRoot = c.req.query('project') || process.cwd();
				const { cfg, db } = await loadProjectDb(projectRoot);
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
				return c.json(
					normalizeSessionRow(updatedSession ?? existingSession, {
						includeRunning: true,
					}),
				);
			} catch (err) {
				logger.error('Failed to mark session viewed', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

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

				return c.json(updatedRows[0]);
			} catch (err) {
				logger.error('Failed to update session', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

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
				const sessionId = c.req.param('sessionId');
				const projectRoot = c.req.query('project') || process.cwd();
				const { cfg, db } = await loadProjectDb(projectRoot);

				const existingSession = await findSessionById(db, sessionId);

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
