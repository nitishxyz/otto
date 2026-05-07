import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import {
	createShare,
	deleteShare,
	getShareStatus,
	listShares,
	loadProjectDb,
	syncShare,
} from './service.ts';

export function registerSessionShareRoutes(app: Hono) {
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'getShareStatus',
			summary: 'Get share status for a session',
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
									shared: {
										type: 'boolean',
									},
									shareId: {
										type: 'string',
									},
									url: {
										type: 'string',
									},
									title: {
										type: 'string',
										nullable: true,
									},
									createdAt: {
										type: 'integer',
									},
									lastSyncedAt: {
										type: 'integer',
									},
									lastSyncedMessageId: {
										type: 'string',
									},
									syncedMessages: {
										type: 'integer',
									},
									totalMessages: {
										type: 'integer',
									},
									pendingMessages: {
										type: 'integer',
									},
									isSynced: {
										type: 'boolean',
									},
								},
								required: ['shared'],
							},
						},
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

	openApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'shareSession',
			summary: 'Share a session',
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
									shared: {
										type: 'boolean',
									},
									shareId: {
										type: 'string',
									},
									url: {
										type: 'string',
									},
									message: {
										type: 'string',
									},
								},
								required: ['shared'],
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
			const sessionId = c.req.param('sessionId');
			const projectRoot = c.req.query('project') || process.cwd();
			const { db } = await loadProjectDb(projectRoot);
			const result = await createShare(db, sessionId);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);

	openApiRoute(
		app,
		{
			method: 'put',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'syncShare',
			summary: 'Sync shared session with new messages',
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
									synced: {
										type: 'boolean',
									},
									url: {
										type: 'string',
									},
									newMessages: {
										type: 'integer',
									},
									message: {
										type: 'string',
									},
								},
								required: ['synced'],
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
			const sessionId = c.req.param('sessionId');
			const projectRoot = c.req.query('project') || process.cwd();
			const { db } = await loadProjectDb(projectRoot);
			const result = await syncShare(db, sessionId);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);

	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/sessions/{sessionId}/share',
			tags: ['sessions'],
			operationId: 'deleteShare',
			summary: 'Delete a shared session',
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
									deleted: {
										type: 'boolean',
									},
									sessionId: {
										type: 'string',
									},
								},
								required: ['deleted', 'sessionId'],
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
			const sessionId = c.req.param('sessionId');
			const projectRoot = c.req.query('project') || process.cwd();
			const { db } = await loadProjectDb(projectRoot);
			const result = await deleteShare(db, sessionId);
			return result.ok
				? c.json(result.body)
				: c.json(result.body, result.status);
		},
	);

	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/shares',
			tags: ['sessions'],
			operationId: 'listShares',
			summary: 'List all shared sessions for a project',
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
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									shares: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												sessionId: {
													type: 'string',
												},
												shareId: {
													type: 'string',
												},
												url: {
													type: 'string',
												},
												title: {
													type: 'string',
													nullable: true,
												},
												createdAt: {
													type: 'integer',
												},
												lastSyncedAt: {
													type: 'integer',
												},
											},
											required: [
												'sessionId',
												'shareId',
												'url',
												'createdAt',
												'lastSyncedAt',
											],
										},
									},
								},
								required: ['shares'],
							},
						},
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
