import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const subagents = sqliteTable('subagents', {
	id: text('id').primaryKey(),
	parentSessionId: text('parent_session_id').notNull(),
	childSessionId: text('child_session_id').notNull(),
	agent: text('agent').notNull(),
	task: text('task').notNull(),
	status: text('status').notNull().default('running'), // 'running' | 'completed' | 'failed' | 'cancelled'
	summary: text('summary'),
	reported: integer('reported', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'number' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});
