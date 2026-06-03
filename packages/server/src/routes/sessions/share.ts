import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	createShare,
	deleteShare,
	getShareStatus,
	listShares,
	loadProjectDb,
	syncShare,
} from './service.ts';

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

const shareStatusSchema = z.object({
	shared: z.boolean(),
	shareId: z.string().optional(),
	url: z.string().optional(),
	title: z.string().nullable().optional(),
	createdAt: z.number().int().optional(),
	lastSyncedAt: z.number().int().optional(),
	lastSyncedMessageId: z.string().optional(),
	syncedMessages: z.number().int().optional(),
	totalMessages: z.number().int().optional(),
	pendingMessages: z.number().int().optional(),
	isSynced: z.boolean().optional(),
});

const shareCreateResponseSchema = z.object({
	shared: z.boolean(),
	shareId: z.string().optional(),
	url: z.string().optional(),
	message: z.string().optional(),
});

const shareSyncResponseSchema = z.object({
	synced: z.boolean(),
	url: z.string().optional(),
	newMessages: z.number().int().optional(),
	message: z.string().optional(),
});

const shareDeleteResponseSchema = z.object({
	deleted: z.boolean(),
	sessionId: z.string(),
});

const shareListItemSchema = z.object({
	sessionId: z.string(),
	shareId: z.string(),
	url: z.string(),
	title: z.string().nullable().optional(),
	createdAt: z.number().int(),
	lastSyncedAt: z.number().int(),
});

const listSharesResponseSchema = z.object({
	shares: z.array(shareListItemSchema),
});

const shareErrorSchema = z.object({
	error: z.string(),
});

export function registerSessionShareRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'getShareStatus',
			summary: 'Get share status for a session',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: shareStatusSchema },
					},
				},
			},
		},
		async (c) => {
			const sessionId = c.req.param('sessionId');
			const projectRoot = c.req.query('project') || process.cwd();
			const { db } = await loadProjectDb(projectRoot);
			return c.json(await getShareStatus(db, sessionId));
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'shareSession',
			summary: 'Share a session',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: shareCreateResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: shareErrorSchema },
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: shareErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const sessionId = c.req.param('sessionId');
			const projectRoot = c.req.query('project') || process.cwd();
			const { db } = await loadProjectDb(projectRoot);
			const result = await createShare(db, sessionId);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'syncShare',
			summary: 'Sync shared session with new messages',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: shareSyncResponseSchema },
					},
				},
				'400': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: shareErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const sessionId = c.req.param('sessionId');
			const projectRoot = c.req.query('project') || process.cwd();
			const { db } = await loadProjectDb(projectRoot);
			const result = await syncShare(db, sessionId);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'deleteShare',
			summary: 'Delete a shared session',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: shareDeleteResponseSchema },
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: shareErrorSchema },
					},
				},
			},
		},
		async (c) => {
			const sessionId = c.req.param('sessionId');
			const projectRoot = c.req.query('project') || process.cwd();
			const { db } = await loadProjectDb(projectRoot);
			const result = await deleteShare(db, sessionId);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/shares',
			tags: ['sessions'],
			operationId: 'listShares',
			summary: 'List all shared sessions for a project',
			request: {
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: listSharesResponseSchema },
					},
				},
			},
		},
		async (c) => {
			const projectRoot = c.req.query('project') || process.cwd();
			const { cfg, db } = await loadProjectDb(projectRoot);
			return c.json({ shares: await listShares(cfg, db) });
		},
	);
}
