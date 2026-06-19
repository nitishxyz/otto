import { goalTasks, goals } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../../openapi/route.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';
import {
	DISABLED_ERROR,
	listTasksForGoal,
	loadGoalsContext,
	serializeGoal,
} from './service.ts';
import {
	createGoalBodySchema,
	goalErrorSchema,
	goalResponseSchema,
	nullableGoalResponseSchema,
	projectQuerySchema,
	sessionIdParamsSchema,
} from './schemas.ts';

export function registerSessionGoalRoutes(app: Hono) {
	registerGetSessionGoalRoute(app);
	registerCreateSessionGoalRoute(app);
}

function registerGetSessionGoalRoute(app: Hono) {
	// Compatibility endpoint for the pre-orchestrator session-goal model.
	zodOpenApiRoute(
		app,
		{
			method: 'get',
			path: '/v1/sessions/{sessionId}/goal',
			tags: ['goals'],
			operationId: 'getSessionGoal',
			summary: 'Get the goal and task queue for a session',
			description:
				'Returns the active goal when one exists, otherwise the most recent goal (completed or abandoned) so finished goals stay visible.',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: nullableGoalResponseSchema },
					},
				},
				'403': {
					description: 'Goals disabled',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { db, enabled } = await loadGoalsContext(c.req.query('project'));
				if (!enabled) return c.json({ error: DISABLED_ERROR }, 403);
				const sessionId = c.req.param('sessionId');
				const activeRows = await db
					.select()
					.from(goals)
					.where(
						and(eq(goals.sessionId, sessionId), eq(goals.status, 'active')),
					)
					.orderBy(asc(goals.createdAt))
					.limit(1);
				let goal = activeRows[0];
				if (!goal) {
					const latestRows = await db
						.select()
						.from(goals)
						.where(eq(goals.sessionId, sessionId))
						.orderBy(desc(goals.updatedAt))
						.limit(1);
					goal = latestRows[0];
				}
				if (!goal) return c.json({ goal: null });
				const tasks = await listTasksForGoal(db, goal.id);
				return c.json({ goal: serializeGoal(goal, tasks) });
			} catch (error) {
				logger.error('Failed to get session goal', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}

function registerCreateSessionGoalRoute(app: Hono) {
	// Compatibility endpoint for the pre-orchestrator session-goal model.
	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/sessions/{sessionId}/goal',
			tags: ['goals'],
			operationId: 'createSessionGoal',
			summary: 'Create a goal with optional initial tasks for a session',
			request: {
				params: sessionIdParamsSchema,
				query: projectQuerySchema,
				body: {
					required: true,
					content: {
						'application/json': { schema: createGoalBodySchema },
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
				'403': {
					description: 'Goals disabled',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
				'409': {
					description: 'Active goal already exists',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { cfg, db, enabled } = await loadGoalsContext(
					c.req.query('project'),
				);
				if (!enabled) return c.json({ error: DISABLED_ERROR }, 403);
				const sessionId = c.req.param('sessionId');
				const body = createGoalBodySchema.parse(await c.req.json());

				const existing = await db
					.select({ id: goals.id })
					.from(goals)
					.where(
						and(eq(goals.sessionId, sessionId), eq(goals.status, 'active')),
					)
					.limit(1);
				if (existing.length) {
					return c.json({ error: 'Session already has an active goal.' }, 409);
				}

				const now = Date.now();
				const goalId = crypto.randomUUID();
				await db.insert(goals).values({
					id: goalId,
					projectPath: cfg.projectRoot,
					sessionId,
					title: body.title,
					status: 'active',
					createdAt: now,
					updatedAt: now,
				});
				if (body.tasks?.length) {
					let position = 0;
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
				}
				const created = await db
					.select()
					.from(goals)
					.where(eq(goals.id, goalId))
					.limit(1);
				const tasks = await listTasksForGoal(db, goalId);
				return c.json({ goal: serializeGoal(created[0], tasks) }, 201);
			} catch (error) {
				logger.error('Failed to create goal', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);
}
