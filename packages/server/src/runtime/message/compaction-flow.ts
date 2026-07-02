import type { getDb } from '@ottocode/database';
import { messages } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../events/bus.ts';
import type { RunOpts } from '../session/queue.ts';
import { performAutoCompaction } from './compaction-auto.ts';
import { pruneSession } from './compaction-prune.ts';

/**
 * Runs the full auto-compaction flow for a session: creates a dedicated
 * assistant message for the compaction summary, streams the summary via
 * performAutoCompaction, falls back to pruning old tool results when
 * summarization fails, and publishes lifecycle events.
 */
export async function runAutoCompactionFlow(args: {
	db: Awaited<ReturnType<typeof getDb>>;
	opts: RunOpts;
	throughMessageId?: string;
}): Promise<{ succeeded: boolean; compactMessageId: string }> {
	const { db, opts } = args;
	const compactMessageId = crypto.randomUUID();
	await db.insert(messages).values({
		id: compactMessageId,
		sessionId: opts.sessionId,
		role: 'assistant',
		status: 'pending',
		agent: opts.agent,
		provider: opts.provider,
		model: opts.model,
		createdAt: Date.now(),
	});

	publish({
		type: 'message.created',
		sessionId: opts.sessionId,
		payload: {
			id: compactMessageId,
			role: 'assistant',
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
		},
	});

	let succeeded = false;
	try {
		const publishWrapper = (event: {
			type: string;
			sessionId: string;
			payload: Record<string, unknown>;
		}) => {
			publish(event as Parameters<typeof publish>[0]);
		};
		const compactResult = await performAutoCompaction(
			db,
			opts.sessionId,
			compactMessageId,
			publishWrapper,
			opts.provider,
			opts.model,
			opts.projectRoot,
			args.throughMessageId,
		);
		if (compactResult.success) {
			succeeded = true;
		} else {
			const pruneResult = await pruneSession(db, opts.sessionId);
			succeeded = pruneResult.pruned > 0;
		}
	} catch {}

	await db
		.update(messages)
		.set({
			status: succeeded ? 'complete' : 'error',
			completedAt: Date.now(),
		})
		.where(eq(messages.id, compactMessageId));

	publish({
		type: 'message.completed',
		sessionId: opts.sessionId,
		payload: { id: compactMessageId, autoCompacted: true },
	});

	return { succeeded, compactMessageId };
}
