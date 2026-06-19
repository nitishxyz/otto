import type { DB } from '@ottocode/database';
import type { goals, goalTasks, sessions } from '@ottocode/database/schema';
import type { OttoConfig } from '@ottocode/sdk';

export type SessionRow = typeof sessions.$inferSelect;
export type GoalRow = typeof goals.$inferSelect;
export type GoalTaskRow = typeof goalTasks.$inferSelect;

export type MaybeWakeOttoInput = {
	db: DB;
	cfg: OttoConfig;
	session: SessionRow;
};
