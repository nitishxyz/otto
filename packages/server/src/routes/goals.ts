import type { Hono } from 'hono';
import { registerListGoalsRoute } from './goals/list.ts';
import { registerSessionGoalRoutes } from './goals/session-goal.ts';
import { registerStartGoalRoute } from './goals/start.ts';
import { registerGoalTaskRoutes } from './goals/tasks.ts';
import { registerUpdateGoalRoute } from './goals/update.ts';

export function registerGoalsRoutes(app: Hono) {
	registerListGoalsRoute(app);
	registerSessionGoalRoutes(app);
	registerUpdateGoalRoute(app);
	registerGoalTaskRoutes(app);
	registerStartGoalRoute(app);
}
