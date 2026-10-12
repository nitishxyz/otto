import type { getDb } from '@ottocode/database';
import { messages, subagents } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { and, desc, eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import { enqueueAssistantRun, type RunOpts } from '../../session/queue.ts';
import type { ContinuationKind, RunSessionLoop } from './types.ts';

type Db = Awaited<ReturnType<typeof getDb>>;

type ContinuationCounters = Pick<
	RunOpts,
	'compactionRetries' | 'continuationCount' | 'streamIdleRetryCount'
>;

const DEFAULT_MAX_RUN_CONTINUATIONS = 4;

/**
 * Ordering rule for every continuation decision made after a turn. Earlier
 * entries win; cancellation always prevents scheduling.
 */
export const CONTINUATION_ORDER: readonly ContinuationKind[] = [
	'stream-idle-retry',
	'context-overflow',
	'max-output',
	'auto-compact',
];

function parsePositiveIntegerEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMaxRunContinuations(): number {
	return parsePositiveIntegerEnv(
		'OTTO_MAX_RUN_CONTINUATIONS',
		DEFAULT_MAX_RUN_CONTINUATIONS,
	);
}

/** Total continuations already spent by this chain of runs, across kinds. */
export function getRunContinuationTotal(opts: ContinuationCounters): number {
	return (
		(opts.compactionRetries ?? 0) +
		(opts.continuationCount ?? 0) +
		(opts.streamIdleRetryCount ?? 0)
	);
}

export function hasContinuationBudget(opts: ContinuationCounters): boolean {
	return getRunContinuationTotal(opts) < getMaxRunContinuations();
}

export function isRunCancelled(opts: Pick<RunOpts, 'abortSignal'>): boolean {
	return opts.abortSignal?.aborted === true;
}

/**
 * Atomically moves a pending assistant message to a terminal state. Returns
 * false when another owner already finalized it.
 */
export async function claimPendingMessage(
	db: Db,
	messageId: string,
	set: Partial<typeof messages.$inferInsert>,
): Promise<boolean> {
	const rows = await db
		.update(messages)
		.set(set)
		.where(and(eq(messages.id, messageId), eq(messages.status, 'pending')))
		.returning({ id: messages.id });
	return rows.length > 0;
}

/**
 * Creates and enqueues a continuation run. Cancellation is checked before the
 * continuation message is created and again right before enqueueing; the
 * combined continuation budget applies to every kind.
 */
export async function scheduleContinuation(args: {
	db: Db;
	opts: RunOpts;
	kind: ContinuationKind;
	counters: ContinuationCounters;
	runSessionLoop: RunSessionLoop;
	front?: boolean;
	createdPayload?: Record<string, unknown>;
}): Promise<string | null> {
	const { db, opts } = args;
	if (isRunCancelled(opts)) return null;
	const nextCounters = { ...opts, ...args.counters };
	if (getRunContinuationTotal(nextCounters) > getMaxRunContinuations()) {
		logger.warn('[agent] continuation budget exhausted', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			kind: args.kind,
			total: getRunContinuationTotal(opts),
			max: getMaxRunContinuations(),
		});
		return null;
	}

	const retryMessageId = crypto.randomUUID();
	const accepted = db.transaction((tx) => {
		if (isRunCancelled(opts)) return false;
		const attempt = tx
			.select()
			.from(subagents)
			.where(eq(subagents.childSessionId, opts.sessionId))
			.orderBy(desc(subagents.createdAt))
			.limit(1)
			.get();
		if (
			attempt &&
			(attempt.status !== 'running' ||
				attempt.attemptId !== opts.assistantMessageId)
		)
			return false;
		const now = Date.now();
		if (attempt) {
			const rebound = tx
				.update(subagents)
				.set({
					attemptId: retryMessageId,
					updatedAt: Math.max(now, attempt.updatedAt + 1),
				})
				.where(
					and(
						eq(subagents.id, attempt.id),
						eq(subagents.status, 'running'),
						eq(subagents.attemptId, opts.assistantMessageId),
						eq(subagents.attemptSeq, attempt.attemptSeq),
						eq(subagents.updatedAt, attempt.updatedAt),
					),
				)
				.returning({ id: subagents.id })
				.get();
			if (!rebound) return false;
		}
		tx.insert(messages)
			.values({
				id: retryMessageId,
				sessionId: opts.sessionId,
				role: 'assistant',
				status: 'pending',
				agent: opts.agent,
				provider: opts.provider,
				model: opts.model,
				createdAt: now,
			})
			.run();
		return true;
	});
	if (!accepted) return null;

	publish({
		type: 'message.created',
		sessionId: opts.sessionId,
		projectId: opts.projectId,
		projectRoot: opts.projectRoot,
		payload: {
			id: retryMessageId,
			role: 'assistant',
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			...(args.createdPayload ?? {}),
		},
	});

	const { abortSignal: _abortSignal, queuedAt: _queuedAt, ...retryOpts } = opts;
	enqueueAssistantRun(
		{
			...retryOpts,
			...args.counters,
			assistantMessageId: retryMessageId,
		},
		args.runSessionLoop,
		args.front ? { front: true } : undefined,
	);
	return retryMessageId;
}
