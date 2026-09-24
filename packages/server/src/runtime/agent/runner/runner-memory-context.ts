import { messageParts } from '@ottocode/database/schema';
import type { Memory, MemoryResult } from '@ottocode/sdk/memory';
import type { getDb } from '@ottocode/database';
import { desc, eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import type { RunOpts } from '../../session/queue.ts';

export type MemoryTurnContext = {
	recall?: {
		query: string;
		ranking: 'typesafe' | 'fts' | 'hybrid' | 'vector';
		retrieved: Memory[];
		injectedIds: string[];
		skipped: Array<{ id: string; reason: 'already-in-message' }>;
	};
	capture?: {
		candidates: string[];
		results: Array<{
			candidate: string;
			status: MemoryResult['status'] | 'skipped';
			reason?: string;
			memory?: Memory;
		}>;
		reason?: 'disabled' | 'no-judge' | 'not-human-turn';
	};
};

/** Persist and stream a synthetic memory result on the current assistant turn. */
export async function persistMemoryTurnContext(
	db: Awaited<ReturnType<typeof getDb>>,
	opts: RunOpts,
	result: MemoryTurnContext,
): Promise<void> {
	if (!result.capture && !result.recall) return;
	const last = await db
		.select({ index: messageParts.index })
		.from(messageParts)
		.where(eq(messageParts.messageId, opts.assistantMessageId))
		.orderBy(desc(messageParts.index))
		.limit(1);
	const callId = crypto.randomUUID();
	const content = {
		name: 'memory_context' as const,
		callId,
		synthetic: true as const,
		origin: 'memory_context' as const,
		result,
	};
	await db.insert(messageParts).values({
		id: crypto.randomUUID(),
		messageId: opts.assistantMessageId,
		index: (last[0]?.index ?? -1) + 1,
		type: 'tool_result',
		content: JSON.stringify(content),
		agent: opts.agent,
		provider: opts.provider,
		model: opts.model,
		startedAt: Date.now(),
		completedAt: Date.now(),
		toolName: 'memory_context',
		toolCallId: callId,
	});
	publish({
		type: 'tool.result',
		sessionId: opts.sessionId,
		projectRoot: opts.projectRoot,
		payload: {
			name: 'memory_context',
			callId,
			messageId: opts.assistantMessageId,
			result,
		},
	});
}
