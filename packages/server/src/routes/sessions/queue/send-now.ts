import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { resolveRequestProject } from '../../project-context.ts';
import { sendSessionQueuedMessageNow } from '../service.ts';
import {
	projectQuerySchema,
	queueMessageParamsSchema,
	sendNowResponseSchema,
} from './schemas.ts';

export function registerSendQueuedMessageNowRoute(app: Hono) {
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
				query: projectQuerySchema,
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
		async (c) => {
			await resolveRequestProject(c);
			const sessionId = c.req.param('sessionId');
			const messageId = c.req.param('messageId');
			const result = sendSessionQueuedMessageNow(sessionId, messageId);
			return result.status
				? c.json(result.body, result.status)
				: c.json(result.body);
		},
	);
}
