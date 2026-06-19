import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../../openapi/route.ts';
import { loadProjectDb } from '../service.ts';
import {
	abortBodySchema,
	abortResponseSchema,
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
				const project = c.req.query('project');
				const { db } = await loadProjectDb(project);
				const { abortChildSubagents } = await import(
					'../../../runtime/subagents/service.ts'
				);
				await abortChildSubagents(db, sessionId);
			} catch {}
			return c.json({ success: true });
		},
	);
}
