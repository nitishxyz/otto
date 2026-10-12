import {
	index,
	sqliteTable,
	text,
	integer,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sessions } from './sessions.ts';

export const messages = sqliteTable(
	'messages',
	{
		id: text('id').primaryKey(),
		sessionId: text('session_id')
			.notNull()
			.references(() => sessions.id, { onDelete: 'cascade' }),
		role: text('role').notNull(), // 'system' | 'user' | 'assistant' | 'tool'
		status: text('status').notNull(), // 'pending' | 'complete' | 'error'
		agent: text('agent').notNull(),
		provider: text('provider').notNull(),
		model: text('model').notNull(),
		createdAt: integer('created_at', { mode: 'number' }).notNull(),
		// Per-session monotonic insertion order. Assigned by a database trigger
		// when omitted on insert; history ordering uses it instead of createdAt.
		sequence: integer('sequence'),
		// Metadata
		completedAt: integer('completed_at', { mode: 'number' }),
		latencyMs: integer('latency_ms'),
		inputTokens: integer('prompt_tokens'),
		outputTokens: integer('completion_tokens'),
		totalTokens: integer('total_tokens'),
		cachedInputTokens: integer('cached_input_tokens'),
		cacheCreationInputTokens: integer('cache_creation_input_tokens'),
		reasoningTokens: integer('reasoning_tokens'),
		// Stream completion diagnostics
		finishReason: text('finish_reason'),
		rawFinishReason: text('raw_finish_reason'),
		finishDetails: text('finish_details'), // JSON string with provider/stream details
		// Error fields
		error: text('error'),
		errorType: text('error_type'), // 'api_error', 'abort', 'validation_error', etc.
		errorDetails: text('error_details'), // JSON string with full error object
		isAborted: integer('is_aborted', { mode: 'boolean' }), // flag for user aborts
	},
	(table) => [
		index('messages_session_created_idx').on(table.sessionId, table.createdAt),
		uniqueIndex('messages_session_sequence_idx').on(
			table.sessionId,
			table.sequence,
		),
	],
);
