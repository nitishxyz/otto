import type { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import {
	runAutoCompactionFlow,
	shouldAutoCompactAfterTurn,
	shouldAutoCompactBeforeOverflow,
	shouldStopTurnForAutoCompact,
} from '../../message/compaction.ts';
import type { RunOpts } from '../../session/queue.ts';
import { isRunCancelled, scheduleContinuation } from '../turn/continuation.ts';
import type { RunSessionLoop } from '../turn/types.ts';

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
	lastStepUsage?: StepUsageLike['usage'];
	runSessionLoop: RunSessionLoop;
}): Promise<boolean> {
	const { db, opts } = args;
	if (isRunCancelled(opts)) return false;

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
		lastStepUsage: args.lastStepUsage,
	});
	if (!shouldCompact) return false;

	const { succeeded } = await runAutoCompactionFlow({
		db,
		opts,
		throughMessageId: opts.assistantMessageId,
	});

	if (succeeded && args.turnStoppedForCompaction) {
		await scheduleContinuation({
			db,
			opts,
			kind: 'auto-compact',
			counters: { compactionRetries: (opts.compactionRetries ?? 0) + 1 },
			runSessionLoop: args.runSessionLoop,
			front: true,
		});
	}

	return true;
}
