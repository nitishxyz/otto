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
} from './schemas.ts';

export function registerStartGoalRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/goals/{goalId}/start',
			tags: ['goals'],
			operationId: 'startGoal',
			summary: 'Start working on a goal via its looper orchestrator',
			description:
				"Dispatches a kickoff message into the goal's looper session (creating one if missing). Looper orchestrates: it marks tasks in_progress, delegates work to agents, verifies results, and completes tasks.",
			request: {
				params: goalIdParamsSchema,
				query: projectQuerySchema,
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
				'409': {
					description: 'Goal cannot be started',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { cfg, db } = await loadGoalsContext(
					await resolveRequestProjectRoot(c),
				);
				const goalId = c.req.param('goalId');
				const rows = await db
					.select()
					.from(goals)
					.where(eq(goals.id, goalId))
					.limit(1);
				const goal = rows[0];
				if (!goal) return c.json({ error: 'Goal not found.' }, 404);
				if (goal.status !== 'active') {
					return c.json({ error: 'Goal is not active.' }, 409);
				}
				const tasks = await listTasksForGoal(db, goalId);
				const openTasks = tasks.filter(
					(task) => task.status !== 'completed' && task.status !== 'cancelled',
				);
				if (!openTasks.length) {
					return c.json({ error: 'Goal has no open tasks.' }, 409);
				}

				const {
					ensureLooperSessionForGoal,
					buildGoalKickoffMessage,
					resetLooperStallState,
				} = await import('../../runtime/looper/service.ts');
				const looperSession = await ensureLooperSessionForGoal(db, cfg, goal);
				if (!looperSession) {
					return c.json(
						{ error: 'Failed to create looper session for goal.' },
						409,
					);
				}

				const content = buildGoalKickoffMessage(goal, tasks);
				const { dispatchAssistantMessage } = await import(
					'../../runtime/message/service.ts'
				);
				await dispatchAssistantMessage({
					cfg,
					db,
					session: looperSession,
					agent: 'looper',
					provider: looperSession.provider as Parameters<
						typeof dispatchAssistantMessage
					>[0]['provider'],
					model: looperSession.model,
					content,
				});

				resetLooperStallState(goal.id);
				const now = Date.now();
				await db
					.update(goals)
					.set({ startedAt: now, updatedAt: now })
					.where(eq(goals.id, goalId));
				const updated = await db
					.select()
					.from(goals)
					.where(eq(goals.id, goalId))
					.limit(1);
				return c.json({ goal: serializeGoal(updated[0], tasks) });
			} catch (error) {
				logger.error('Failed to start goal', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
