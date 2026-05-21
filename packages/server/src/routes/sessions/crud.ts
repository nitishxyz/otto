import { sessions } from '@ottocode/database/schema';
import { hasConfiguredProvider, logger, type ProviderId } from '@ottocode/sdk';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import { resolveAgentConfig } from '../../runtime/agent/registry.ts';
import { createSession as createSessionRow } from '../../runtime/session/manager.ts';
import {
	buildSessionPreferenceUpdates,
	deleteSessionMessagesAndParts,
	findSessionById,
	getSessionFileStats,
	loadProjectDb,
	normalizeSessionRow,
} from './service.ts';

export function registerSessionCrudRoutes(app: Hono) {
	// List sessions
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions',
			tags: ['sessions'],
			operationId: 'listSessions',
			summary: 'List sessions',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
				{
					in: 'query',
					name: 'limit',
					schema: {
						type: 'integer',
						default: 50,
						minimum: 1,
						maximum: 200,
					},
					description: 'Maximum number of sessions to return',
				},
				{
					in: 'query',
					name: 'offset',
					schema: {
						type: 'integer',
						default: 0,
						minimum: 0,
					},
					description: 'Offset for pagination',
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									items: {
										type: 'array',
										items: {
											$ref: '#/components/schemas/Session',
										},
									},
									hasMore: {
										type: 'boolean',
									},
									nextOffset: {
										type: 'integer',
										nullable: true,
									},
								},
								required: ['items', 'hasMore', 'nextOffset'],
							},
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
			// Only return sessions for this project, excluding research sessions
			const rows = await db
				.select()
				.from(sessions)
				.where(
					and(
						eq(sessions.projectPath, cfg.projectRoot),
						ne(sessions.sessionType, 'research'),
					),
				)
				.orderBy(desc(sessions.lastActiveAt), desc(sessions.createdAt))
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

	// Create session
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions',
			tags: ['sessions'],
			operationId: 'createSession',
			summary: 'Create a new session',
			parameters: [
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								title: {
									type: 'string',
									nullable: true,
								},
								agent: {
									type: 'string',
								},
								provider: {
									$ref: '#/components/schemas/Provider',
								},
								model: {
									type: 'string',
								},
							},
						},
					},
				},
			},
			responses: {
				'201': {
					description: 'Created',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/Session',
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
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
				});
				return c.json(row, 201);
			} catch (err) {
				logger.error('Failed to create session', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 400);
			}
		},
	);

	// Get single session
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}',
			tags: ['sessions'],
			operationId: 'getSession',
			summary: 'Get a single session by ID',
			parameters: [
				{
					in: 'path',
					name: 'sessionId',
					required: true,
					schema: {
						type: 'string',
					},
				},
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/Session',
							},
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
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

	// Mark session as viewed by the user
	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/viewed',
			tags: ['sessions'],
			operationId: 'markSessionViewed',
			summary: 'Mark a session as viewed',
			parameters: [
				{
					in: 'path',
					name: 'sessionId',
					required: true,
					schema: {
						type: 'string',
					},
				},
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/Session',
							},
						},
					},
				},
				'404': {
					description: 'Not Found',
				},
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

	// Update session preferences
	openApiRoute(
		app,
		{
			method: 'patch',
			path: '/v1/sessions/{sessionId}',
			tags: ['sessions'],
			operationId: 'updateSession',
			summary: 'Update session preferences',
			parameters: [
				{
					in: 'path',
					name: 'sessionId',
					required: true,
					schema: {
						type: 'string',
					},
				},
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								title: {
									type: 'string',
								},
								agent: {
									type: 'string',
								},
								provider: {
									$ref: '#/components/schemas/Provider',
								},
								model: {
									type: 'string',
								},
							},
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								$ref: '#/components/schemas/Session',
							},
						},
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
								},
								required: ['error'],
							},
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
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

				const body = (await c.req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;

				const existingSession = await findSessionById(db, sessionId);

				if (!existingSession) {
					return c.json({ error: 'Session not found' }, 404);
				}

				// Verify session belongs to current project
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

				// Perform update
				await db
					.update(sessions)
					.set(updateResult.updates)
					.where(eq(sessions.id, sessionId));

				// Return updated session
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

	// Delete session
	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/sessions/{sessionId}',
			tags: ['sessions'],
			operationId: 'deleteSession',
			summary: 'Delete a session',
			parameters: [
				{
					in: 'path',
					name: 'sessionId',
					required: true,
					schema: {
						type: 'string',
					},
				},
				{
					in: 'query',
					name: 'project',
					required: false,
					schema: {
						type: 'string',
					},
					description:
						'Project root override (defaults to current working directory).',
				},
			],
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									success: {
										type: 'boolean',
									},
								},
								required: ['success'],
							},
						},
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									error: {
										type: 'string',
									},
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
