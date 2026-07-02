import { goals } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	listTasksForGoal,
	loadGoalsContext,
	serializeGoal,
} from './service.ts';
import {
	goalErrorSchema,
	goalIdParamsSchema,
	goalResponseSchema,
	projectQuerySchema,
	updateGoalBodySchema,
} from './schemas.ts';

export function registerUpdateGoalRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'patch',
			path: '/v1/goals/{goalId}',
			tags: ['goals'],
			operationId: 'updateGoal',
			summary: 'Update goal title or status',
			request: {
				params: goalIdParamsSchema,
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: updateGoalBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: goalResponseSchema },
					},
				},
				'404': {
					description: 'Not Found',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { db } = await loadGoalsContext(
					await resolveRequestProjectRoot(c),
				);
				const goalId = c.req.param('goalId');
				const body = updateGoalBodySchema.parse(await c.req.json());
				const rows = await db
					.select()
					.from(goals)
					.where(eq(goals.id, goalId))
					.limit(1);
				if (!rows.length) return c.json({ error: 'Goal not found.' }, 404);
				await db
					.update(goals)
					.set({
						...(body.title ? { title: body.title } : {}),
						...(body.status ? { status: body.status } : {}),
						updatedAt: Date.now(),
					})
					.where(eq(goals.id, goalId));
				const updated = await db
					.select()
					.from(goals)
					.where(eq(goals.id, goalId))
					.limit(1);
				const tasks = await listTasksForGoal(db, goalId);
				return c.json({ goal: serializeGoal(updated[0], tasks) });
			} catch (error) {
				logger.error('Failed to update goal', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
