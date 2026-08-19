import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { sessionRepository } from '../../../runtime/session/repository.ts';
import { resolveRequestProject } from '../../project-context.ts';
import {
	abortBodySchema,
	abortResponseSchema,
	projectQuerySchema,
	sessionIdParamsSchema,
} from './schemas.ts';

export function registerAbortSessionRoute(app: Hono) {
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
				query: projectQuerySchema,
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
			const { sessionId } = c.req.valid('param');
			const { messageId, clearQueue = false } = c.req.valid('json') ?? {};
			const project = await resolveRequestProject(c);
			await sessionRepository(project.db, project.projectRoot).require(
				sessionId,
			);

			const { abortSession, abortMessage } = await import(
				'../../../runtime/agent/runner.ts'
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
			try {
				const { db } = project;
				const { abortChildSubagents } = await import(
					'../../../runtime/subagents/service.ts'
				);
				await abortChildSubagents(db, sessionId);
			} catch {}
			return c.json({ success: true });
		},
	);
}
