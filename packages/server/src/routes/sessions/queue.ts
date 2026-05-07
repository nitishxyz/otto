import type { Hono } from 'hono';
import { openApiRoute } from '../../openapi/route.ts';
import {
	getSessionQueueState,
	loadProjectDb,
	removeSessionQueueMessage,
} from './service.ts';

export function registerSessionQueueRoutes(app: Hono) {
	// Abort session stream
	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/sessions/{sessionId}/abort',
			tags: ['sessions'],
			operationId: 'abortSession',
			summary: 'Abort a running session',
			description:
				'Aborts any currently running assistant generation for the session',
			parameters: [
				{
					in: 'path',
					name: 'sessionId',
					required: true,
					schema: {
						type: 'string',
					},
					description: 'Session ID to abort',
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
			},
		},
		async (c) => {
			const sessionId = c.req.param('sessionId');
			const body = (await c.req.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			const messageId =
				typeof body.messageId === 'string' ? body.messageId : undefined;
			const clearQueue = body.clearQueue === true;

			const { abortSession, abortMessage } = await import(
				'../../runtime/agent/runner.ts'
			);

			if (messageId) {
				const result = abortMessage(sessionId, messageId);
				return c.json({
					success: result.removed,
					wasRunning: result.wasRunning,
					messageId,
				});
			}

			abortSession(sessionId, clearQueue);
			return c.json({ success: true });
		},
	);

	// Get queue state for a session
	openApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/queue',
			tags: ['sessions'],
			operationId: 'getSessionQueue',
			summary: 'Get queue state for a session',
			parameters: [
				{
					in: 'path',
					name: 'sessionId',
					required: true,
					schema: {
						type: 'string',
					},
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
									currentMessageId: {
										type: 'string',
										nullable: true,
									},
									queuedMessages: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												assistantMessageId: {
													type: 'string',
												},
												agent: {
													type: 'string',
												},
												provider: {
													type: 'string',
												},
												model: {
													type: 'string',
												},
											},
										},
									},
									isRunning: {
										type: 'boolean',
									},
								},
								required: ['currentMessageId', 'queuedMessages', 'isRunning'],
							},
						},
					},
				},
			},
		},
		async (c) => {
			const sessionId = c.req.param('sessionId');
			return c.json(getSessionQueueState(sessionId));
		},
	);

	// Remove a message from the queue
	openApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/sessions/{sessionId}/queue/{messageId}',
			tags: ['sessions'],
			operationId: 'removeFromQueue',
			summary: 'Remove a message from session queue',
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
					in: 'path',
					name: 'messageId',
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
									removed: {
										type: 'boolean',
									},
									wasQueued: {
										type: 'boolean',
									},
									wasRunning: {
										type: 'boolean',
									},
									wasStored: {
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
			const sessionId = c.req.param('sessionId');
			const messageId = c.req.param('messageId');
			const projectRoot = c.req.query('project') || process.cwd();
			const { db } = await loadProjectDb(projectRoot);
			const result = await removeSessionQueueMessage(db, sessionId, messageId);
			return result.status
				? c.json(result.body, result.status)
				: c.json(result.body);
		},
	);
}
