import { z } from '@hono/zod-openapi';
import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from '@ottocode/database';
import { goalTasks, goals } from '@ottocode/database/schema';
import { loadConfig, logger } from '@ottocode/sdk';
import type { Hono } from 'hono';
import { zodOpenApiRoute } from '../openapi/route.ts';
import { serializeError } from '../runtime/errors/api-error.ts';

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

const sessionIdParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
});

const goalIdParamsSchema = z.object({
	goalId: z.string().openapi({
		param: { name: 'goalId', in: 'path' },
	}),
});

const goalTaskParamsSchema = z.object({
	goalId: z.string().openapi({
		param: { name: 'goalId', in: 'path' },
	}),
	taskId: z.string().openapi({
		param: { name: 'taskId', in: 'path' },
	}),
});

const goalStatusSchema = z.enum(['active', 'completed', 'abandoned']);
const taskStatusSchema = z.enum([
	'pending',
	'in_progress',
	'done_pending',
	'completed',
	'blocked',
	'cancelled',
]);

const goalTaskSchema = z.object({
	id: z.string(),
	goalId: z.string(),
	position: z.number(),
	content: z.string(),
	status: taskStatusSchema,
	note: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
});

const goalSchema = z.object({
	id: z.string(),
	projectPath: z.string(),
	sessionId: z.string().nullable(),
	title: z.string(),
	status: goalStatusSchema,
	startedAt: z.number().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
	tasks: z.array(goalTaskSchema),
});

const goalErrorSchema = z.object({ error: z.string() });

const createGoalBodySchema = z.object({
	title: z.string().min(1),
	tasks: z.array(z.string().min(1)).optional(),
});

const updateGoalBodySchema = z.object({
	title: z.string().min(1).optional(),
	status: goalStatusSchema.optional(),
});

const addTasksBodySchema = z.object({
	tasks: z.array(z.string().min(1)).min(1),
});

const updateTaskBodySchema = z.object({
	content: z.string().min(1).optional(),
	status: taskStatusSchema.optional(),
	note: z.string().nullable().optional(),
});

type GoalRow = typeof goals.$inferSelect;
type GoalTaskRow = typeof goalTasks.$inferSelect;

function serializeGoal(goal: GoalRow, tasks: GoalTaskRow[]) {
	return {
		id: goal.id,
		projectPath: goal.projectPath,
		sessionId: goal.sessionId,
		title: goal.title,
		status: goal.status,
		startedAt: goal.startedAt,
		createdAt: goal.createdAt,
		updatedAt: goal.updatedAt,
		tasks: tasks.map((task) => ({
			id: task.id,
			goalId: task.goalId,
			position: task.position,
			content: task.content,
			status: task.status,
			note: task.note,
			createdAt: task.createdAt,
			updatedAt: task.updatedAt,
		})),
	};
}

async function loadGoalsContext(projectRoot?: string) {
	const cfg = await loadConfig(projectRoot || process.cwd());
	const db = await getDb(cfg.projectRoot);
	const enabled = cfg.defaults.ottoEnabled !== false;
	return { cfg, db, enabled };
}

async function listTasksForGoal(
	db: Awaited<ReturnType<typeof getDb>>,
	goalId: string,
): Promise<GoalTaskRow[]> {
	return await db
		.select()
		.from(goalTasks)
		.where(eq(goalTasks.goalId, goalId))
		.orderBy(asc(goalTasks.position));
}

const DISABLED_ERROR =
	'Goals are disabled because otto is disabled (defaults.ottoEnabled).';

export function registerGoalsRoutes(app: Hono) {
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
						'application/json': {
							schema: z.object({ goal: goalSchema.nullable() }),
						},
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
						'application/json': { schema: z.object({ goal: goalSchema }) },
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
						'application/json': { schema: z.object({ goal: goalSchema }) },
					},
				},
				'403': {
					description: 'Goals disabled',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
				'404': {
					description: 'Not Found',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { db, enabled } = await loadGoalsContext(c.req.query('project'));
				if (!enabled) return c.json({ error: DISABLED_ERROR }, 403);
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
						'application/json': { schema: z.object({ goal: goalSchema }) },
					},
				},
				'403': {
					description: 'Goals disabled',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
				'404': {
					description: 'Not Found',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { db, enabled } = await loadGoalsContext(c.req.query('project'));
				if (!enabled) return c.json({ error: DISABLED_ERROR }, 403);
				const goalId = c.req.param('goalId');
				const body = addTasksBodySchema.parse(await c.req.json());
				const rows = await db
					.select()
					.from(goals)
					.where(eq(goals.id, goalId))
					.limit(1);
				if (!rows.length) return c.json({ error: 'Goal not found.' }, 404);
				const existingTasks = await listTasksForGoal(db, goalId);
				let position = existingTasks.length
					? Math.max(...existingTasks.map((t) => t.position)) + 1
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
						'application/json': {
							schema: z.object({ task: goalTaskSchema }),
						},
					},
				},
				'403': {
					description: 'Goals disabled',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
				'404': {
					description: 'Not Found',
					content: { 'application/json': { schema: goalErrorSchema } },
				},
			},
		},
		async (c) => {
			try {
				const { db, enabled } = await loadGoalsContext(c.req.query('project'));
				if (!enabled) return c.json({ error: DISABLED_ERROR }, 403);
				const goalId = c.req.param('goalId');
				const taskId = c.req.param('taskId');
				const body = updateTaskBodySchema.parse(await c.req.json());
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
				const task = updated[0];
				return c.json({
					task: {
						id: task.id,
						goalId: task.goalId,
						position: task.position,
						content: task.content,
						status: task.status,
						note: task.note,
						createdAt: task.createdAt,
						updatedAt: task.updatedAt,
					},
				});
			} catch (error) {
				logger.error('Failed to update goal task', error);
				const errorResponse = serializeError(error);
				return c.json(errorResponse, errorResponse.error.status || 500);
			}
		},
	);

	zodOpenApiRoute(
		app,
		{
			method: 'post',
			path: '/v1/goals/{goalId}/start',
			tags: ['goals'],
			operationId: 'startGoal',
			summary: 'Start working on a goal in its session',
			description:
				'Injects an automated tagged kickoff message into the goal session so the agent works through the task queue. Otto continues the loop between runs.',
			request: {
				params: goalIdParamsSchema,
				query: projectQuerySchema,
			},
			responses: {
				'200': {
					description: 'OK',
					content: {
						'application/json': { schema: z.object({ goal: goalSchema }) },
					},
				},
				'403': {
					description: 'Goals disabled',
					content: { 'application/json': { schema: goalErrorSchema } },
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
				const { cfg, db, enabled } = await loadGoalsContext(
					c.req.query('project'),
				);
				if (!enabled) return c.json({ error: DISABLED_ERROR }, 403);
				const goalId = c.req.param('goalId');
				const rows = await db
					.select()
					.from(goals)
					.where(eq(goals.id, goalId))
					.limit(1);
				const goal = rows[0];
				if (!goal) return c.json({ error: 'Goal not found.' }, 404);
				if (!goal.sessionId) {
					return c.json({ error: 'Goal has no session.' }, 409);
				}
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

				const { getSessionById } = await import(
					'../runtime/session/manager.ts'
				);
				const session = await getSessionById({
					db,
					sessionId: goal.sessionId,
				});
				if (!session) {
					return c.json({ error: 'Goal session no longer exists.' }, 404);
				}

				const taskLines = tasks.map(
					(task) => `- [${task.status}] ${task.content}`,
				);
				const content = [
					`<goal_start goal-id="${goal.id}">`,
					`<title>${goal.title}</title>`,
					'<tasks>',
					...taskLines,
					'</tasks>',
					'</goal_start>',
					'',
					'Work through the open tasks in order. Use goal_list for the latest state. Before starting a task, mark it in_progress with goal_update; when finished, claim it with done_pending. Delegate to specialist agents with delegate_task where it helps. If a task says to use a specific agent, delegate it and do not perform that same task yourself unless the sub-agent fails or independent verification is explicitly requested. Otto verifies your claims and keeps the goal moving between runs.',
				].join('\n');

				const { dispatchAssistantMessage } = await import(
					'../runtime/message/service.ts'
				);
				await dispatchAssistantMessage({
					cfg,
					db,
					session,
					agent: session.agent,
					provider: session.provider as Parameters<
						typeof dispatchAssistantMessage
					>[0]['provider'],
					model: session.model,
					content,
				});

				const { resetOttoStallState } = await import(
					'../runtime/otto/service.ts'
				);
				resetOttoStallState(goal.sessionId);

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
