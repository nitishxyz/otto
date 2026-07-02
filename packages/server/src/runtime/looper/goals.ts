import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { goalTasks, goals } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import type { GoalRow, GoalTaskRow } from './types.ts';

/**
 * Resolves the active goal an idle session belongs to: first via task
 * dispatch (goal_tasks.sessionId), then via the legacy session binding
 * (goals.sessionId).
 */
export async function findGoalForIdleSession(
	db: DB,
	sessionId: string,
): Promise<GoalRow | undefined> {
	const viaTask = await db
		.select({ goal: goals })
		.from(goalTasks)
		.innerJoin(goals, eq(goalTasks.goalId, goals.id))
		.where(and(eq(goalTasks.sessionId, sessionId), eq(goals.status, 'active')))
		.orderBy(asc(goals.createdAt))
		.limit(1);
	if (viaTask[0]) return viaTask[0].goal;
	const rows = await db
		.select()
		.from(goals)
		.where(and(eq(goals.sessionId, sessionId), eq(goals.status, 'active')))
		.orderBy(asc(goals.createdAt))
		.limit(1);
	return rows[0];
}

export async function listGoalTasks(
	db: DB,
	goalId: string,
): Promise<GoalTaskRow[]> {
	return await db
		.select()
		.from(goalTasks)
		.where(eq(goalTasks.goalId, goalId))
		.orderBy(asc(goalTasks.position), asc(goalTasks.createdAt));
}

export async function completeGoal(db: DB, goal: GoalRow): Promise<void> {
	await db
		.update(goals)
		.set({ status: 'completed', updatedAt: Date.now() })
		.where(eq(goals.id, goal.id));
	const eventSessionId = goal.looperSessionId ?? goal.sessionId;
	if (eventSessionId) {
		publish({
			type: 'goal.updated',
			sessionId: eventSessionId,
			payload: { goalId: goal.id, changes: ['goal completed'] },
		});
	}
	logger.info('[looper] goal completed', { goalId: goal.id });
}
