import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const goals = sqliteTable('goals', {
	id: text('id').primaryKey(),
	projectPath: text('project_path').notNull(),
	sessionId: text('session_id'),
	ottoSessionId: text('otto_session_id'),
	title: text('title').notNull(),
	status: text('status').notNull().default('active'), // 'active' | 'completed' | 'abandoned'
	startedAt: integer('started_at', { mode: 'number' }),
	createdAt: integer('created_at', { mode: 'number' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});
