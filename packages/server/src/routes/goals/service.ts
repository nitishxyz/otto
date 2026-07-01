import { getDb } from '@ottocode/database';
import { goalTasks, type goals } from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { asc, eq } from 'drizzle-orm';

export type GoalRow = typeof goals.$inferSelect;
export type GoalTaskRow = typeof goalTasks.$inferSelect;
export type GoalsDb = Awaited<ReturnType<typeof getDb>>;

export const DISABLED_ERROR =
	'Goals are disabled because otto is disabled (defaults.ottoEnabled).';

export function serializeGoal(goal: GoalRow, tasks: GoalTaskRow[]) {
	return {
		id: goal.id,
		projectPath: goal.projectPath,
		sessionId: goal.sessionId,
		ottoSessionId: goal.ottoSessionId,
		title: goal.title,
		status: goal.status,
		startedAt: goal.startedAt,
		createdAt: goal.createdAt,
		updatedAt: goal.updatedAt,
		tasks: tasks.map(serializeGoalTask),
	};
}

export function serializeGoalTask(task: GoalTaskRow) {
	return {
		id: task.id,
		goalId: task.goalId,
		sessionId: task.sessionId,
		position: task.position,
		content: task.content,
		status: task.status,
		note: task.note,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
	};
}

export async function loadGoalsContext(projectRoot: string) {
	const cfg = await loadConfig(projectRoot);
	const db = await getDb(cfg.projectRoot);
	const enabled = cfg.defaults.ottoEnabled !== false;
	return { cfg, db, enabled };
}

export async function listTasksForGoal(
	db: GoalsDb,
	goalId: string,
): Promise<GoalTaskRow[]> {
	return await db
		.select()
		.from(goalTasks)
		.where(eq(goalTasks.goalId, goalId))
		.orderBy(asc(goalTasks.position), asc(goalTasks.createdAt));
}
