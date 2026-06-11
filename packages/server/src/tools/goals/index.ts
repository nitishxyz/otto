import { tool } from 'ai';
import { z } from 'zod/v3';
import { and, asc, eq, or } from 'drizzle-orm';
import { getDb } from '@ottocode/database';
import { goalTasks, goals } from '@ottocode/database/schema';
import { publish } from '../../events/bus.ts';

const TASK_STATUSES = [
	'pending',
	'in_progress',
	'completed',
	'blocked',
	'cancelled',
] as const;

type BuildGoalToolsArgs = {
	projectRoot: string;
	/**
	 * Otto session that owns this goal thread. Goals are bound to their otto
	 * session via goals.ottoSessionId (legacy goals via goals.sessionId).
	 */
	ottoSessionId: string;
};

async function loadGoalWithTasks(projectRoot: string, ottoSessionId: string) {
	const db = await getDb(projectRoot);
	const goalRows = await db
		.select()
		.from(goals)
		.where(
			and(
				eq(goals.status, 'active'),
				or(
					eq(goals.ottoSessionId, ottoSessionId),
					eq(goals.sessionId, ottoSessionId),
				),
			),
		)
		.orderBy(asc(goals.createdAt))
		.limit(1);
	const goal = goalRows[0];
	if (!goal) return { db, goal: undefined, tasks: [] as const };
	const tasks = await db
		.select()
		.from(goalTasks)
		.where(eq(goalTasks.goalId, goal.id))
		.orderBy(asc(goalTasks.position));
	return { db, goal, tasks };
}

function serializeTask(task: typeof goalTasks.$inferSelect) {
	return {
		id: task.id,
		position: task.position,
		content: task.content,
		status: task.status,
		note: task.note ?? undefined,
		sessionId: task.sessionId ?? undefined,
	};
}

export function buildGoalListTool(args: BuildGoalToolsArgs) {
	return {
		name: 'goal_list',
		tool: tool({
			description:
				'List the goal this otto session supervises and its task queue. Tasks persist across runs; use goal_update to change them.',
			inputSchema: z.object({}),
			async execute() {
				const { goal, tasks } = await loadGoalWithTasks(
					args.projectRoot,
					args.ottoSessionId,
				);
				if (!goal) {
					return { ok: true, goal: null, tasks: [] };
				}
				return {
					ok: true,
					goal: { id: goal.id, title: goal.title, status: goal.status },
					tasks: tasks.map(serializeTask),
				};
			},
		}),
	};
}

export function buildGoalUpdateTool(args: BuildGoalToolsArgs) {
	const inputSchema = z.object({
		createGoal: z
			.object({ title: z.string().min(1) })
			.optional()
			.describe('Create a new active goal owned by this otto session'),
		completeGoal: z
			.boolean()
			.optional()
			.describe('Mark the active goal completed once all tasks are closed'),
		addTasks: z
			.array(z.string().min(1))
			.optional()
			.describe('Append new tasks to the active goal, in order'),
		updateTasks: z
			.array(
				z.object({
					id: z.string().min(1),
					status: z.enum(TASK_STATUSES).optional(),
					note: z.string().optional(),
					content: z.string().min(1).optional(),
					sessionId: z
						.string()
						.optional()
						.describe(
							'Worker session or subagent session executing this task; record it when dispatching',
						),
					position: z
						.number()
						.int()
						.min(0)
						.optional()
						.describe('New queue position (reorder)'),
				}),
			)
			.optional()
			.describe(
				'Update task state. You are the only writer: mark a task in_progress when you dispatch it, completed after you verified the delegation result, blocked/cancelled with a note otherwise.',
			),
	});

	return {
		name: 'goal_update',
		tool: tool({
			description:
				'Create or update the persistent goal/task queue you orchestrate. Workers never touch goals: you dispatch tasks with delegate_task, verify results, and record every status change here yourself.',
			inputSchema,
			async execute(input) {
				const db = await getDb(args.projectRoot);
				let { goal, tasks } = await loadGoalWithTasks(
					args.projectRoot,
					args.ottoSessionId,
				);
				const now = Date.now();

				if (!goal && input.createGoal) {
					const id = crypto.randomUUID();
					await db.insert(goals).values({
						id,
						projectPath: args.projectRoot,
						ottoSessionId: args.ottoSessionId,
						title: input.createGoal.title,
						status: 'active',
						createdAt: now,
						updatedAt: now,
					});
					const created = await db
						.select()
						.from(goals)
						.where(eq(goals.id, id))
						.limit(1);
					goal = created[0];
					tasks = [];
				}
				if (!goal) {
					return {
						ok: false,
						error:
							'No active goal for this otto session. Pass createGoal to start one.',
					};
				}

				const results: string[] = [];

				if (input.addTasks?.length) {
					let position = tasks.length
						? Math.max(...tasks.map((t) => t.position)) + 1
						: 0;
					for (const content of input.addTasks) {
						await db.insert(goalTasks).values({
							id: crypto.randomUUID(),
							goalId: goal.id,
							position: position++,
							content,
							status: 'pending',
							note: null,
							createdAt: now,
							updatedAt: now,
						});
					}
					results.push(`added ${input.addTasks.length} task(s)`);
				}

				if (input.updateTasks?.length) {
					let workStarted = false;
					for (const update of input.updateTasks) {
						const existing = tasks.find((t) => t.id === update.id);
						if (!existing) {
							results.push(`task ${update.id} not found`);
							continue;
						}
						if (update.status === 'in_progress') workStarted = true;
						await db
							.update(goalTasks)
							.set({
								...(update.status ? { status: update.status } : {}),
								...(update.note !== undefined ? { note: update.note } : {}),
								...(update.content ? { content: update.content } : {}),
								...(update.sessionId !== undefined
									? { sessionId: update.sessionId }
									: {}),
								...(update.position !== undefined
									? { position: update.position }
									: {}),
								updatedAt: now,
							})
							.where(eq(goalTasks.id, update.id));
						results.push(`task ${update.id} updated`);
					}
					if (workStarted && !goal.startedAt) {
						await db
							.update(goals)
							.set({ startedAt: now, updatedAt: now })
							.where(eq(goals.id, goal.id));
					}
				}

				if (input.completeGoal) {
					await db
						.update(goals)
						.set({ status: 'completed', updatedAt: now })
						.where(eq(goals.id, goal.id));
					results.push('goal completed');
				}

				const refreshed = await loadGoalWithTasks(
					args.projectRoot,
					args.ottoSessionId,
				);
				if (results.length) {
					publish({
						type: 'goal.updated',
						sessionId: args.ottoSessionId,
						payload: { goalId: goal.id, changes: results },
					});
				}
				return {
					ok: true,
					changes: results,
					goal: refreshed.goal
						? {
								id: refreshed.goal.id,
								title: refreshed.goal.title,
								status: refreshed.goal.status,
							}
						: { id: goal.id, title: goal.title, status: 'completed' },
					tasks: refreshed.tasks.map(serializeTask),
				};
			},
		}),
	};
}

export function buildGoalTools(args: BuildGoalToolsArgs) {
	return [buildGoalListTool(args), buildGoalUpdateTool(args)];
}
