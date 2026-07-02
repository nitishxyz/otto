import { goalTasks, goals } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { resolveRequestProjectRoot } from '../project-context.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	type GoalTaskRow,
	loadGoalsContext,
	serializeGoal,
} from './service.ts';
import { goalsResponseSchema, projectQuerySchema } from './schemas.ts';

export function registerListGoalsRoute(app: Hono) {
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/goals',
			tags: ['goals'],
			operationId: 'listGoals',
			summary: 'List goals for the project',
			description:
				'Returns every goal recorded for the project (active, completed, and abandoned), each with its task queue, ordered by most recent activity.',
			request: { query: projectQuerySchema },
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: goalsResponseSchema },
					},
				},
			},
		},
		async (c) => {
			try {
				const { cfg, db } = await loadGoalsContext(
					await resolveRequestProjectRoot(c),
				);
				const rows = await db
					.select()
					.from(goals)
					.where(eq(goals.projectPath, cfg.projectRoot))
					.orderBy(desc(goals.updatedAt));
				const goalIds = rows.map((goal) => goal.id);
				const taskRows = goalIds.length
					? await db
							.select()
							.from(goalTasks)
							.where(inArray(goalTasks.goalId, goalIds))
							.orderBy(asc(goalTasks.position), asc(goalTasks.createdAt))
					: [];
				const tasksByGoalId = new Map<string, GoalTaskRow[]>();
				for (const task of taskRows) {
					const tasks = tasksByGoalId.get(task.goalId) ?? [];
					tasks.push(task);
					tasksByGoalId.set(task.goalId, tasks);
				}
				const serialized = rows.map((goal) =>
					serializeGoal(goal, tasksByGoalId.get(goal.id) ?? []),
				);
				return c.json({ goals: serialized });
			} catch (error) {
				logger.error('Failed to list goals', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
