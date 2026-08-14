import type { getDb } from '@ottocode/database';
import { messages, sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import { publishAssistantMessageError } from '../../errors/assistant-message-error.ts';
import { isContextOverflowError } from '../../errors/context-overflow.ts';
import { toErrorPayload } from '../../errors/handling.ts';
import {
	runAutoCompactionFlow,
	shouldAutoCompactAfterTurn,
	shouldAutoCompactBeforeOverflow,
	shouldStopTurnForAutoCompact,
} from '../../message/compaction.ts';
import type {
	updateMessageTokensIncremental,
	updateSessionTokensIncremental,
} from '../../session/db-operations.ts';
import { enqueueAssistantRun, type RunOpts } from '../../session/queue.ts';
import { recoverContextOverflow } from './runner-context-overflow.ts';

type UpdateSessionTokensIncremental = typeof updateSessionTokensIncremental;
type UpdateMessageTokensIncremental = typeof updateMessageTokensIncremental;

export async function shouldPreemptivelyAutoCompact(
	db: Awaited<ReturnType<typeof getDb>>,
	opts: RunOpts,
	threshold: number | null | undefined,
): Promise<boolean> {
	const sessionRows = await db
		.select({ currentContextTokens: sessions.currentContextTokens })
		.from(sessions)
		.where(eq(sessions.id, opts.sessionId))
		.limit(1);

	return shouldAutoCompactBeforeOverflow({
		autoCompactThresholdTokens: threshold,
		currentContextTokens: sessionRows[0]?.currentContextTokens ?? 0,
		estimatedInputTokens: opts.estimatedInputTokens ?? 0,
		isCompactCommand: opts.isCompactCommand,
		compactionRetries: opts.compactionRetries,
	});
}

type StepUsageLike = {
	usage?: { inputTokens?: number; outputTokens?: number };
};

/**
 * Builds a streamText stop condition that halts the tool loop as soon as the
 * configured auto-compaction threshold is crossed mid-turn. Returns null when
 * the threshold does not apply to this run.
 */
export function createAutoCompactStopCondition(
	opts: RunOpts,
	threshold: number | null | undefined,
	onTrigger: () => void,
): ((options: { steps: Array<StepUsageLike> }) => boolean) | null {
	const normalized = Number(threshold ?? 0);
	if (!Number.isFinite(normalized) || normalized <= 0) return null;
	if (opts.isCompactCommand) return null;
	if ((opts.compactionRetries ?? 0) > 0) return null;

	return ({ steps }) => {
		const shouldStop = shouldStopTurnForAutoCompact({
			autoCompactThresholdTokens: threshold,
			isCompactCommand: opts.isCompactCommand,
			compactionRetries: opts.compactionRetries,
			lastStepUsage: steps.at(-1)?.usage ?? null,
		});
		if (shouldStop) onTrigger();
		return shouldStop;
	};
}

/**
 * Compacts the session right after a turn finishes when the configured
 * auto-compaction threshold has been reached. When the turn was cut short by
 * the mid-turn stop condition, a continuation run is enqueued so the agent
 * can resume its interrupted work against the compacted context.
 */
export async function autoCompactSessionAfterTurn(args: {
	db: Awaited<ReturnType<typeof getDb>>;
	opts: RunOpts;
	threshold: number | null | undefined;
	turnStoppedForCompaction: boolean;
	runSessionLoop: (sessionId: string) => Promise<void>;
}): Promise<boolean> {
	const { db, opts } = args;
	if (opts.abortSignal?.aborted) return false;

	const sessionRows = await db
		.select({ currentContextTokens: sessions.currentContextTokens })
		.from(sessions)
		.where(eq(sessions.id, opts.sessionId))
		.limit(1);

	const shouldCompact = shouldAutoCompactAfterTurn({
		autoCompactThresholdTokens: args.threshold,
		currentContextTokens: sessionRows[0]?.currentContextTokens ?? 0,
		isCompactCommand: opts.isCompactCommand,
		compactionRetries: opts.compactionRetries,
		turnStoppedForCompaction: args.turnStoppedForCompaction,
	});
	if (!shouldCompact) return false;

	const { succeeded } = await runAutoCompactionFlow({
		db,
		opts,
		throughMessageId: opts.assistantMessageId,
	});

	if (succeeded && args.turnStoppedForCompaction) {
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

		const {
			abortSignal: _abortSignal,
			queuedAt: _queuedAt,
			...retryOpts
		} = opts;
		enqueueAssistantRun(
			{
				...retryOpts,
				assistantMessageId: retryMessageId,
				compactionRetries: (opts.compactionRetries ?? 0) + 1,
			},
			args.runSessionLoop,
			{ front: true },
		);
	}

	return true;
}

export async function handleRunnerError(args: {
	err: unknown;
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	updateSessionTokensIncremental: UpdateSessionTokensIncremental;
	updateMessageTokensIncremental: UpdateMessageTokensIncremental;
	runSessionLoop: (sessionId: string) => Promise<void>;
	nextPartIndex?: () => number | Promise<number>;
}): Promise<'handled' | 'rethrow'> {
	const { err, opts, db } = args;
	const payload = toErrorPayload(err);

	if (isContextOverflowError(err) && !opts.isCompactCommand) {
		try {
			const recovery = await recoverContextOverflow({
				db,
				opts,
				runSessionLoop: args.runSessionLoop,
			});
			if (recovery !== 'failed') return 'handled';
		} catch {}
	}

	try {
		await args.updateSessionTokensIncremental(
			{ inputTokens: 0, outputTokens: 0 },
			undefined,
			opts,
			db,
		);
		await args.updateMessageTokensIncremental(
			{ inputTokens: 0, outputTokens: 0 },
			undefined,
			opts,
			db,
		);
	} catch {}

	await publishAssistantMessageError({
		db,
		opts,
		error: {
			message: payload.message,
			type: payload.type,
			details: payload.details,
			isAborted: false,
		},
		nextPartIndex: args.nextPartIndex,
	});
	return 'rethrow';
}
