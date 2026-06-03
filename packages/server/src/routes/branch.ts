import { z } from '@hono/zod-openapi';
import { getDb } from '@ottocode/database';
import { hasConfiguredProvider, loadConfig, logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { serializeError } from '../runtime/errors/api-error.ts';
import {
	createBranch,
	getParentSession,
	listBranches,
} from '../runtime/session/branch.ts';

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

const sessionIdParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
});

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

const createBranchBodySchema = z.object({
	fromMessageId: z.string(),
	provider: z.string().optional(),
	model: z.string().optional(),
	agent: z.string().optional(),
	title: z.string().optional(),
});

const branchErrorSchema = z.object({
	error: z.string(),
});

const listBranchesResponseSchema = z.object({
	branches: z.array(sessionSchema),
});

const getParentSessionResponseSchema = z.object({
	parent: sessionSchema.nullable(),
});

export function registerBranchRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/branch',
			tags: ['sessions'],
			operationId: 'createBranch',
			summary: 'Create a branch from a session message',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: createBranchBodySchema },
					},
				},
			},
			responses: {
				'201': {
					description: 'Created',
					content: {
						'application/json': { schema: sessionSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: branchErrorSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const sessionId = c.req.param('sessionId');
				const projectRoot = c.req.query('project') || process.cwd();
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);

				const body = (await c.req.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;

				const fromMessageId = body.fromMessageId;
				if (typeof fromMessageId !== 'string' || !fromMessageId.trim()) {
					return c.json({ error: 'fromMessageId is required' }, 400);
				}

				const provider =
					typeof body.provider === 'string' &&
					hasConfiguredProvider(cfg, body.provider)
						? body.provider
						: undefined;

				const model =
					typeof body.model === 'string' && body.model.trim()
						? body.model.trim()
						: undefined;

				const agent =
					typeof body.agent === 'string' && body.agent.trim()
						? body.agent.trim()
						: undefined;

				const title =
					typeof body.title === 'string' && body.title.trim()
						? body.title.trim()
						: undefined;

				const result = await createBranch({
					db,
					parentSessionId: sessionId,
					fromMessageId: fromMessageId.trim(),
					provider,
					model,
					agent,
					title,
					projectPath: cfg.projectRoot,
				});

				return c.json(result, 201);
			} catch (err) {
				logger.error('Failed to create branch', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 400);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/branches',
			tags: ['sessions'],
			operationId: 'listBranches',
			summary: 'List branches of a session',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: listBranchesResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const sessionId = c.req.param('sessionId');
				const projectRoot = c.req.query('project') || process.cwd();
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);

				const branches = await listBranches(db, sessionId, cfg.projectRoot);

				return c.json({ branches });
			} catch (err) {
				logger.error('Failed to list branches', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/parent',
			tags: ['sessions'],
			operationId: 'getParentSession',
			summary: 'Get parent session of a branch',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: getParentSessionResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const sessionId = c.req.param('sessionId');
				const projectRoot = c.req.query('project') || process.cwd();
				const cfg = await loadConfig(projectRoot);
				const db = await getDb(cfg.projectRoot);

				const parent = await getParentSession(db, sessionId, cfg.projectRoot);

				if (!parent) {
					return c.json({ parent: null });
				}

				return c.json({ parent });
			} catch (err) {
				logger.error('Failed to get parent session', err);
				const errorResponse = serializeError(err);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
