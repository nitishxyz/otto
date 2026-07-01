import { index, sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { messages } from './messages.ts';

export const messageParts = sqliteTable(
	'message_parts',
	{
		id: text('id').primaryKey(),
		messageId: text('message_id')
			.notNull()
			.references(() => messages.id, { onDelete: 'cascade' }),
		index: integer('index').notNull(),
		stepIndex: integer('step_index'),
		type: text('type').notNull(), // 'text' | 'tool_call' | 'tool_result' | 'image' | 'error'
		content: text('content').notNull(), // JSON string
		agent: text('agent').notNull(),
		provider: text('provider').notNull(),
		model: text('model').notNull(),
		// Timestamps
		startedAt: integer('started_at', { mode: 'number' }),
		completedAt: integer('completed_at', { mode: 'number' }),
		compactedAt: integer('compacted_at', { mode: 'number' }),
		// Tool metadata (for tool_call/tool_result)
		toolName: text('tool_name'),
		toolCallId: text('tool_call_id'),
		toolDurationMs: integer('tool_duration_ms'),
	},
	(table) => [
		index('message_parts_message_index_idx').on(table.messageId, table.index),
	],
);
