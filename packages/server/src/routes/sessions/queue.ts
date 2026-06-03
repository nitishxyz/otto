import { z } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import {
	getSessionQueueState,
	loadProjectDb,
	removeSessionQueueMessage,
	sendSessionQueuedMessageNow,
} from './service.ts';

const sessionIdParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
});

const queueMessageParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
	messageId: z.string().openapi({
		param: { name: 'messageId', in: 'path' },
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

const abortBodySchema = z.object({
	messageId: z.string().optional(),
	clearQueue: z.boolean().optional(),
});

const abortResponseSchema = z.object({
	success: z.boolean(),
	wasRunning: z.boolean().optional(),
	messageId: z.string().optional(),
});

const queueStateSchema = z.object({
	currentMessageId: z.string().nullable(),
	queuedMessages: z.array(
		z.object({
			assistantMessageId: z.string(),
			agent: z.string(),
			provider: z.string(),
			model: z.string(),
		}),
	),
	isRunning: z.boolean(),
});

const sendNowResponseSchema = z.object({
	success: z.boolean(),
	promoted: z.boolean(),
	wasQueued: z.boolean().optional(),
	wasRunning: z.boolean().optional(),
	preemptedMessageId: z.string().nullable().optional(),
});

const removeQueueResponseSchema = z.object({
	success: z.boolean(),
	removed: z.boolean().optional(),
	wasQueued: z.boolean().optional(),
	wasRunning: z.boolean().optional(),
	wasStored: z.boolean().optional(),
});

const queueErrorSchema = z.object({
	error: z.string(),
});

export function registerSessionQueueRoutes(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/sessions/{sessionId}/abort',
			tags: ['sessions'],
			operationId: 'abortSession',
			summary: 'Abort a running session',
			description:
				'Aborts any currently running assistant generation for the session',
			request: {
				params: sessionIdParamsSchema,
				body: {
					required: false,
					content: {
						'application/json': { schema: abortBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: abortResponseSchema },
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

	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/queue',
			tags: ['sessions'],
			operationId: 'getSessionQueue',
			summary: 'Get queue state for a session',
			request: {
				params: sessionIdParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: queueStateSchema },
					},
				},
			},
		},
		async (c) => {
			const sessionId = c.req.param('sessionId');
			return c.json(getSessionQueueState(sessionId));
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/queue/{messageId}/send-now',
			tags: ['sessions'],
			operationId: 'sendQueuedMessageNow',
			summary: 'Send a queued message now',
			description:
				'Promotes a queued message to run next and silently preempts the active assistant generation.',
			request: {
				params: queueMessageParamsSchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: sendNowResponseSchema },
					},
				},
				'404': {
					description: 'Queued message not found',
					content: {
						'application/json': { schema: sendNowResponseSchema },
					},
				},
			},
		},
		(c) => {
			const sessionId = c.req.param('sessionId');
			const messageId = c.req.param('messageId');
			const result = sendSessionQueuedMessageNow(sessionId, messageId);
			return result.status
				? c.json(result.body, result.status)
				: c.json(result.body);
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/sessions/{sessionId}/queue/{messageId}',
			tags: ['sessions'],
			operationId: 'removeFromQueue',
			summary: 'Remove a message from session queue',
			request: {
				params: queueMessageParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: removeQueueResponseSchema },
					},
				},
				'404': {
					description: 'Bad Request',
					content: {
						'application/json': { schema: queueErrorSchema },
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
