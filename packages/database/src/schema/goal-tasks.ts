import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const goalTasks = sqliteTable('goal_tasks', {
	id: text('id').primaryKey(),
	goalId: text('goal_id').notNull(),
	position: integer('position').notNull(),
	content: text('content').notNull(),
	// 'pending' | 'in_progress' | 'done_pending' | 'completed' | 'blocked' | 'cancelled'
	status: text('status').notNull().default('pending'),
	note: text('note'),
	createdAt: integer('created_at', { mode: 'number' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});
