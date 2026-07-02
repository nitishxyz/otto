import { z } from '@hono/zod-openapi';

export const projectQuerySchema = z.object({
	project: z
		.string()
		.optional()
		.openapi({
			param: { name: 'project', in: 'query' },
			description:
				'Project root override (defaults to current working directory).',
		}),
});

export const sessionIdParamsSchema = z.object({
	sessionId: z.string().openapi({
		param: { name: 'sessionId', in: 'path' },
	}),
});

export const goalIdParamsSchema = z.object({
	goalId: z.string().openapi({
		param: { name: 'goalId', in: 'path' },
	}),
});

export const goalTaskParamsSchema = z.object({
	goalId: z.string().openapi({
		param: { name: 'goalId', in: 'path' },
	}),
	taskId: z.string().openapi({
		param: { name: 'taskId', in: 'path' },
	}),
});

export const goalStatusSchema = z.enum(['active', 'completed', 'abandoned']);
export const taskStatusSchema = z.enum([
	'pending',
	'in_progress',
	'completed',
	'blocked',
	'cancelled',
]);

export const goalTaskSchema = z.object({
	id: z.string(),
	goalId: z.string(),
	sessionId: z.string().nullable(),
	position: z.number(),
	content: z.string(),
	status: taskStatusSchema,
	note: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export const goalSchema = z.object({
	id: z.string(),
	projectPath: z.string(),
	sessionId: z.string().nullable(),
	looperSessionId: z.string().nullable(),
	title: z.string(),
	status: goalStatusSchema,
	startedAt: z.number().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
	tasks: z.array(goalTaskSchema),
});

export const goalsResponseSchema = z.object({ goals: z.array(goalSchema) });
export const goalResponseSchema = z.object({ goal: goalSchema });
export const nullableGoalResponseSchema = z.object({
	goal: goalSchema.nullable(),
});
export const taskResponseSchema = z.object({ task: goalTaskSchema });
export const goalErrorSchema = z.object({ error: z.string() });

export const createGoalBodySchema = z.object({
	title: z.string().min(1),
	tasks: z.array(z.string().min(1)).optional(),
});

export const updateGoalBodySchema = z.object({
	title: z.string().min(1).optional(),
	status: goalStatusSchema.optional(),
});

export const addTasksBodySchema = z.object({
	tasks: z.array(z.string().min(1)).min(1),
});

export const updateTaskBodySchema = z.object({
	content: z.string().min(1).optional(),
	status: taskStatusSchema.optional(),
	note: z.string().nullable().optional(),
});
