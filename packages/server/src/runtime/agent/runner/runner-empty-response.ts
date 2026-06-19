import type { getDb } from '@ottocode/database';
import { messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import type { RunOpts } from '../../session/queue.ts';
import { markEmptyAssistantResponseAsError } from '../../stream/finish-handler.ts';
import type { RunnerToolObserverState } from './runner-tool-observer.ts';

export async function markEmptyResponseAfterFinalAttempt(args: {
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	finishReason: string | undefined;
	rawFinishReason: string | undefined;
	toolObserver: RunnerToolObserverState;
}): Promise<boolean> {
	if (args.finishReason === 'error') return false;
	if (args.opts.abortSignal?.aborted) return false;

	const assistantParts = await args.db
		.select({ id: messageParts.id })
		.from(messageParts)
		.where(eq(messageParts.messageId, args.opts.assistantMessageId))
		.limit(1);
	if (assistantParts.length > 0) return false;

	// If this run observed tool activity, do not synthesize an empty-response
	// error here. Tool-only or retried turns can legitimately have no final text
	// while still doing useful work, and retry/continuation flow owns recovery.
	if (args.toolObserver.toolActivityObserved) return false;

	await markEmptyAssistantResponseAsError({
		opts: args.opts,
		db: args.db,
		fin: {
			finishReason: args.finishReason,
			rawFinishReason: args.rawFinishReason,
		},
	});
	return true;
}
