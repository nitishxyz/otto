import { index, sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		title: text('title'),
		agent: text('agent').notNull(),
		provider: text('provider').notNull(),
		model: text('model').notNull(),
		projectPath: text('project_path').notNull(),
		createdAt: integer('created_at', { mode: 'number' }).notNull(),
		// Metadata
		lastActiveAt: integer('last_active_at', { mode: 'number' }),
		lastViewedAt: integer('last_viewed_at', { mode: 'number' }),
		pinnedAt: integer('pinned_at', { mode: 'number' }),
		totalInputTokens: integer('total_input_tokens'),
		totalOutputTokens: integer('total_output_tokens'),
		totalCachedTokens: integer('total_cached_tokens'),
		totalCacheCreationTokens: integer('total_cache_creation_tokens'),
		totalReasoningTokens: integer('total_reasoning_tokens'),
		totalToolTimeMs: integer('total_tool_time_ms'),
		toolCountsJson: text('tool_counts_json'), // JSON object of name->count
		currentContextTokens: integer('current_context_tokens'),
		// Compaction
		contextSummary: text('context_summary'), // LLM-generated summary of conversation context
		lastCompactedAt: integer('last_compacted_at', { mode: 'number' }),
		compactionMessageId: text('compaction_message_id'), // Latest canonical checkpoint; model history starts after it
		// Branching
		parentSessionId: text('parent_session_id'),
		branchPointMessageId: text('branch_point_message_id'),
		sessionType: text('session_type').default('main'),
	},
	(table) => [
		index('sessions_project_type_activity_idx').on(
			table.projectPath,
			table.sessionType,
			table.lastActiveAt,
			table.createdAt,
		),
		index('sessions_parent_type_idx').on(
			table.parentSessionId,
			table.sessionType,
		),
	],
);
