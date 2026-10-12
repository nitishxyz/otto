import { sql } from 'drizzle-orm';
import {
	sqliteTable,
	text,
	integer,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const subagents = sqliteTable(
	'subagents',
	{
		id: text('id').primaryKey(),
		parentSessionId: text('parent_session_id').notNull(),
		childSessionId: text('child_session_id').notNull(),
		agent: text('agent').notNull(),
		task: text('task').notNull(),
		status: text('status').notNull().default('running'), // 'running' | 'completed' | 'failed' | 'cancelled'
		summary: text('summary'),
		reported: integer('reported', { mode: 'boolean' }).notNull().default(false),
		// Identity of the current/latest attempt; attemptSeq increments per attempt.
		attemptId: text('attempt_id'),
		attemptSeq: integer('attempt_seq').notNull().default(0),
		// Parent result outbox: 'none' while running, 'pending' once terminal and
		// awaiting parent delivery, 'delivered' once claimed by a parent message.
		deliveryState: text('delivery_state', {
			enum: ['none', 'pending', 'delivered'],
		})
			.notNull()
			.default('none'),
		deliveryKey: text('delivery_key'),
		// Child assistant message whose completion finalized the attempt.
		finishedMessageId: text('finished_message_id'),
		createdAt: integer('created_at', { mode: 'number' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
	},
	(table) => [
		uniqueIndex('subagents_running_child_unique')
			.on(table.childSessionId)
			.where(sql`status = 'running'`),
	],
);
