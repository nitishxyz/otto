import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { sessionRepository } from '../../../runtime/session/repository.ts';
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
			const project = await resolveRequestProject(c);
			const { sessionId, messageId } = c.req.valid('param');
			await sessionRepository(project.db, project.projectRoot).require(
				sessionId,
			);
			const result = sendSessionQueuedMessageNow(sessionId, messageId);
			return result.status
				? c.json(result.body, result.status)
				: c.json(result.body);
		},
	);
}
