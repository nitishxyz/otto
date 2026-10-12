import type { getDb } from '@ottocode/database';
import { publish } from '../../../events/bus.ts';
import { runAutoCompactionFlow } from '../../message/compaction.ts';
import type { RunOpts } from '../../session/queue.ts';
import {
	claimPendingMessage,
	hasContinuationBudget,
	isRunCancelled,
	scheduleContinuation,
} from '../turn/continuation.ts';
import type { RunSessionLoop } from '../turn/types.ts';

const MAX_COMPACTION_RETRIES = 2;

/** Compacts an overflowing run and queues exactly one continuation attempt. */
export async function recoverContextOverflow(args: {
	db: Awaited<ReturnType<typeof getDb>>;
	opts: RunOpts;
	runSessionLoop: RunSessionLoop;
	runCompaction?: typeof runAutoCompactionFlow;
}): Promise<'retried' | 'handled' | 'failed'> {
	const { db, opts } = args;
	if ((opts.compactionRetries ?? 0) >= MAX_COMPACTION_RETRIES) return 'failed';
	if (!hasContinuationBudget(opts)) return 'failed';
	if (isRunCancelled(opts)) return 'failed';

	const claimed = await claimPendingMessage(db, opts.assistantMessageId, {
		status: 'complete',
		completedAt: Date.now(),
	});
	if (!claimed) return 'handled';

	const { succeeded } = await (args.runCompaction ?? runAutoCompactionFlow)({
		db,
		opts,
		throughMessageId: opts.assistantMessageId,
	});
	if (!succeeded) return 'failed';

	publish({
		type: 'message.completed',
		sessionId: opts.sessionId,
		projectId: opts.projectId,
		projectRoot: opts.projectRoot,
		payload: {
			id: opts.assistantMessageId,
			autoCompacted: true,
		},
	});

	const retryMessageId = await scheduleContinuation({
		db,
		opts,
		kind: 'context-overflow',
		counters: { compactionRetries: (opts.compactionRetries ?? 0) + 1 },
		runSessionLoop: args.runSessionLoop,
		front: true,
	});
	return retryMessageId ? 'retried' : 'handled';
}
