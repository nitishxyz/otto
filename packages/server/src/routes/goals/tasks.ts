import { goalTasks, goals } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { publish } from '../../events/bus.ts';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	listTasksForGoal,
	loadGoalsContext,
	serializeGoal,
	serializeGoalTask,
} from './service.ts';
import {
	addTasksBodySchema,
	goalErrorSchema,
	goalIdParamsSchema,
	goalResponseSchema,
	goalTaskParamsSchema,
	projectQuerySchema,
	taskResponseSchema,
	updateTaskBodySchema,
} from './schemas.ts';

export function registerGoalTaskRoutes(app: Hono) {
	registerAddGoalTasksRoute(app);
	registerUpdateGoalTaskRoute(app);
	registerDeleteGoalTaskRoute(app);
}

function registerAddGoalTasksRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/goals/{goalId}/tasks',
			tags: ['goals'],
			operationId: 'addGoalTasks',
			summary: 'Append tasks to a goal',
			request: {
				params: goalIdParamsSchema,
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: addTasksBodySchema },
					},
				},
			},
			responses: {
				'201': {
					description: 'Created',
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
				const { goalId } = c.req.valid('param');
				const body = c.req.valid('json');
				const rows = await db
					.select()
					.from(goals)
					.where(eq(goals.id, goalId))
					.limit(1);
				if (!rows.length) return c.json({ error: 'Goal not found.' }, 404);
				const existingTasks = await listTasksForGoal(db, goalId);
				let position = existingTasks.length
					? Math.max(...existingTasks.map((task) => task.position)) + 1
					: 0;
				const now = Date.now();
				for (const content of body.tasks) {
					await db.insert(goalTasks).values({
						id: crypto.randomUUID(),
						goalId,
						position: position++,
						content,
						status: 'pending',
						note: null,
						createdAt: now,
						updatedAt: now,
					});
				}
				const reactivate = rows[0].status !== 'active';
				await db
					.update(goals)
					.set({
						updatedAt: now,
						...(reactivate ? { status: 'active', startedAt: null } : {}),
					})
					.where(eq(goals.id, goalId));
				const tasks = await listTasksForGoal(db, goalId);
				const updatedGoal = reactivate
					? { ...rows[0], status: 'active', startedAt: null }
					: rows[0];
				return c.json({ goal: serializeGoal(updatedGoal, tasks) }, 201);
			} catch (error) {
				logger.error('Failed to add goal tasks', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}

function registerUpdateGoalTaskRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'patch',
			path: '/v1/goals/{goalId}/tasks/{taskId}',
			tags: ['goals'],
			operationId: 'updateGoalTask',
			summary: 'Update a goal task',
			request: {
				params: goalTaskParamsSchema,
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: updateTaskBodySchema },
					},
				},
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: taskResponseSchema },
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
				const { goalId, taskId } = c.req.valid('param');
				const body = c.req.valid('json');
				const rows = await db
					.select()
					.from(goalTasks)
					.where(and(eq(goalTasks.id, taskId), eq(goalTasks.goalId, goalId)))
					.limit(1);
				if (!rows.length) return c.json({ error: 'Task not found.' }, 404);
				const now = Date.now();
				await db
					.update(goalTasks)
					.set({
						...(body.content ? { content: body.content } : {}),
						...(body.status ? { status: body.status } : {}),
						...(body.note !== undefined ? { note: body.note } : {}),
						updatedAt: now,
					})
					.where(eq(goalTasks.id, taskId));
				const updated = await db
					.select()
					.from(goalTasks)
					.where(eq(goalTasks.id, taskId))
					.limit(1);
				return c.json({ task: serializeGoalTask(updated[0]) });
			} catch (error) {
				logger.error('Failed to update goal task', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}

function registerDeleteGoalTaskRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'delete',
			path: '/v1/goals/{goalId}/tasks/{taskId}',
			tags: ['goals'],
			operationId: 'deleteGoalTask',
			summary: 'Delete a goal task',
			description:
				'Removes a task from the goal queue. Tasks currently in_progress cannot be deleted; cancel them instead so looper and the worker stay consistent.',
			request: {
				params: goalTaskParamsSchema,
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
					description: 'Task cannot be deleted',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { db } = await loadGoalsContext(
					await resolveRequestProjectRoot(c),
				);
				const { goalId, taskId } = c.req.valid('param');
				const goalRows = await db
					.select()
					.from(goals)
					.where(eq(goals.id, goalId))
					.limit(1);
				if (!goalRows.length) {
					return c.json({ error: 'Goal not found.' }, 404);
				}
				const rows = await db
					.select()
					.from(goalTasks)
					.where(and(eq(goalTasks.id, taskId), eq(goalTasks.goalId, goalId)))
					.limit(1);
				if (!rows.length) return c.json({ error: 'Task not found.' }, 404);
				if (rows[0].status === 'in_progress') {
					return c.json(
						{
							error:
								'Task is in progress. Cancel it instead of deleting so looper and the worker stay consistent.',
						},
						409,
					);
				}
				await db.delete(goalTasks).where(eq(goalTasks.id, taskId));
				const now = Date.now();
				await db
					.update(goals)
					.set({ updatedAt: now })
					.where(eq(goals.id, goalId));
				publish({
					type: 'goal.updated',
					sessionId: goalRows[0].looperSessionId ?? goalRows[0].sessionId ?? '',
					payload: { goalId, changes: [`task ${taskId} deleted`] },
				});
				const tasks = await listTasksForGoal(db, goalId);
				const updated = await db
					.select()
					.from(goals)
					.where(eq(goals.id, goalId))
					.limit(1);
				return c.json({ goal: serializeGoal(updated[0], tasks) });
			} catch (error) {
				logger.error('Failed to delete goal task', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
