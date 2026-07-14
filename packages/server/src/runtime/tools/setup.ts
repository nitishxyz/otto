import type { getDb } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import { eq, desc } from 'drizzle-orm';
import { time } from '../debug/index.ts';
import type { ToolAdapterContext } from '../../tools/adapter.ts';
import type { RunOpts } from '../session/queue.ts';

export type RunnerToolContext = ToolAdapterContext & { stepIndex: number };

/**
 * Sets up the shared tool context for a run, including the index counter
 * and first tool call tracking.
 */
export async function setupToolContext(
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
	readOnlyRoots: string[] = [],
) {
	const firstToolTimer = time('runner:first-tool-call');
	let firstToolSeen = false;

	const existingParts = await db
		.select({ index: messageParts.index })
		.from(messageParts)
		.where(eq(messageParts.messageId, opts.assistantMessageId))
		.orderBy(desc(messageParts.index))
		.limit(1);
	let currentIndex = existingParts.length > 0 ? existingParts[0].index + 1 : 0;
	const nextIndex = () => currentIndex++;

	const sharedCtx: RunnerToolContext = {
		nextIndex,
		stepIndex: 0,
		sessionId: opts.sessionId,
		messageId: opts.assistantMessageId,
		assistantPartId: '', // Will be set by runner when first text part is created
		db,
		agent: opts.agent,
		provider: opts.provider,
		model: opts.model,
		projectRoot: opts.projectRoot,
		readOnlyRoots,
		stepExecution: { states: new Map() },
		toolApprovalMode: opts.toolApprovalMode,
		onFirstToolCall: () => {
			if (firstToolSeen) return;
			firstToolSeen = true;
			firstToolTimer.end();
		},
	};

	return { sharedCtx, firstToolTimer, firstToolSeen: () => firstToolSeen };
}
