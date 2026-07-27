import type { getDb } from '@ottocode/database';
import { messages } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import { runAutoCompactionFlow } from '../../message/compaction.ts';
import { enqueueAssistantRun, type RunOpts } from '../../session/queue.ts';

/** Compacts an overflowing run and queues exactly one continuation attempt. */
export async function recoverContextOverflow(args: {
	db: Awaited<ReturnType<typeof getDb>>;
	opts: RunOpts;
	runSessionLoop: (sessionId: string) => Promise<void>;
	runCompaction?: typeof runAutoCompactionFlow;
}): Promise<'retried' | 'handled' | 'failed'> {
	const { db, opts } = args;
	const messageRows = await db
		.select({ status: messages.status })
		.from(messages)
		.where(eq(messages.id, opts.assistantMessageId))
		.limit(1);
	if (messageRows[0]?.status !== 'pending') return 'handled';
	if ((opts.compactionRetries ?? 0) >= 2) return 'failed';

	await db
		.update(messages)
		.set({ status: 'complete', completedAt: Date.now() })
		.where(eq(messages.id, opts.assistantMessageId));

	const { succeeded } = await (args.runCompaction ?? runAutoCompactionFlow)({
		db,
		opts,
		throughMessageId: opts.assistantMessageId,
	});
	if (!succeeded) return 'failed';

	publish({
		type: 'message.completed',
		sessionId: opts.sessionId,
		payload: {
			id: opts.assistantMessageId,
			autoCompacted: true,
		},
	});

	const retryMessageId = crypto.randomUUID();
	await db.insert(messages).values({
		id: retryMessageId,
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
			id: retryMessageId,
			role: 'assistant',
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
		},
	});

	const { abortSignal: _abortSignal, queuedAt: _queuedAt, ...retryOpts } = opts;
	enqueueAssistantRun(
		{
			...retryOpts,
			assistantMessageId: retryMessageId,
			compactionRetries: (opts.compactionRetries ?? 0) + 1,
		},
		args.runSessionLoop,
		{ front: true },
	);

	return 'retried';
}
