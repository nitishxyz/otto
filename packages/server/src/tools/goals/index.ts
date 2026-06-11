import { tool } from 'ai';
import { z } from 'zod/v3';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@ottocode/database';
import { goalTasks, goals } from '@ottocode/database/schema';
import { publish } from '../../events/bus.ts';

const AGENT_TASK_STATUSES = [
	'pending',
	'in_progress',
	'done_pending',
	'blocked',
	'cancelled',
] as const;

const OTTO_TASK_STATUSES = [...AGENT_TASK_STATUSES, 'completed'] as const;

type BuildGoalToolsArgs = {
	projectRoot: string;
	/** Session the goals are scoped to (parent session when running as otto). */
	goalSessionId: string;
	/** Otto may finalize tasks/goals; regular agents may only claim. */
	allowComplete: boolean;
};

async function loadGoalWithTasks(projectRoot: string, sessionId: string) {
	const db = await getDb(projectRoot);
	const goalRows = await db
		.select()
		.from(goals)
		.where(and(eq(goals.sessionId, sessionId), eq(goals.status, 'active')))
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

export function buildGoalListTool(args: BuildGoalToolsArgs) {
	return {
		name: 'goal_list',
		tool: tool({
			description:
				'List the active goal and its task queue for this session. Tasks persist across runs; use goal_update to change them.',
			inputSchema: z.object({}),
			async execute() {
				const { goal, tasks } = await loadGoalWithTasks(
					args.projectRoot,
					args.goalSessionId,
				);
				if (!goal) {
					return { ok: true, goal: null, tasks: [] };
				}
				return {
					ok: true,
					goal: { id: goal.id, title: goal.title, status: goal.status },
					tasks: tasks.map((task) => ({
						id: task.id,
						position: task.position,
						content: task.content,
						status: task.status,
						note: task.note ?? undefined,
					})),
				};
			},
		}),
	};
}

export function buildGoalUpdateTool(args: BuildGoalToolsArgs) {
	const statuses = args.allowComplete
		? OTTO_TASK_STATUSES
		: AGENT_TASK_STATUSES;
	const inputSchema = z.object({
		createGoal: z
			.object({ title: z.string().min(1) })
			.optional()
			.describe('Create a new active goal for this session if none exists'),
		...(args.allowComplete
			? {
					completeGoal: z
						.boolean()
						.optional()
						.describe('Mark the active goal completed (otto only)'),
				}
			: {}),
		addTasks: z
			.array(z.string().min(1))
			.optional()
			.describe('Append new tasks to the active goal, in order'),
		updateTasks: z
			.array(
				z.object({
					id: z.string().min(1),
					status: z
						.enum(statuses as unknown as [string, ...string[]])
						.optional(),
					note: z.string().optional(),
					content: z.string().min(1).optional(),
				}),
			)
			.optional()
			.describe(
				args.allowComplete
					? 'Update task statuses/notes. You may set completed after verifying a done_pending claim.'
					: 'Update task statuses/notes. Mark finished work as done_pending — only otto can set completed.',
			),
	});

	return {
		name: 'goal_update',
		tool: tool({
			description: args.allowComplete
				? 'Create or update the persistent goal/task queue. As otto you verify done_pending claims and finalize them to completed, or reset false claims to in_progress with a note.'
				: 'Create or update the persistent goal/task queue for this session. Claim finished tasks with done_pending; otto verifies and finalizes them.',
			inputSchema,
			async execute(input) {
				const db = await getDb(args.projectRoot);
				let { goal, tasks } = await loadGoalWithTasks(
					args.projectRoot,
					args.goalSessionId,
				);
				const now = Date.now();

				if (!goal && input.createGoal) {
					const id = crypto.randomUUID();
					await db.insert(goals).values({
						id,
						projectPath: args.projectRoot,
						sessionId: args.goalSessionId,
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
							'No active goal for this session. Pass createGoal to start one.',
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
					for (const update of input.updateTasks) {
						const existing = tasks.find((t) => t.id === update.id);
						if (!existing) {
							results.push(`task ${update.id} not found`);
							continue;
						}
						if (update.status === 'completed' && !args.allowComplete) {
							results.push(
								`task ${update.id}: completed is reserved for otto; use done_pending`,
							);
							continue;
						}
						await db
							.update(goalTasks)
							.set({
								...(update.status ? { status: update.status } : {}),
								...(update.note !== undefined ? { note: update.note } : {}),
								...(update.content ? { content: update.content } : {}),
								updatedAt: now,
							})
							.where(eq(goalTasks.id, update.id));
						results.push(`task ${update.id} updated`);
					}
				}

				if (input.completeGoal && args.allowComplete) {
					await db
						.update(goals)
						.set({ status: 'completed', updatedAt: now })
						.where(eq(goals.id, goal.id));
					results.push('goal completed');
				}

				const refreshed = await loadGoalWithTasks(
					args.projectRoot,
					args.goalSessionId,
				);
				if (results.length) {
					publish({
						type: 'goal.updated',
						sessionId: args.goalSessionId,
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
					tasks: refreshed.tasks.map((task) => ({
						id: task.id,
						position: task.position,
						content: task.content,
						status: task.status,
						note: task.note ?? undefined,
					})),
				};
			},
		}),
	};
}

export function buildGoalTools(args: BuildGoalToolsArgs) {
	return [buildGoalListTool(args), buildGoalUpdateTool(args)];
}
