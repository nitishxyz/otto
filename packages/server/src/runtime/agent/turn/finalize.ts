import { logger } from '@ottocode/sdk';
import type { getDb } from '@ottocode/database';
import type { RunOpts } from '../../session/queue.ts';
import { toErrorPayload } from '../../errors/handling.ts';
import type { FinishEvent } from '../../stream/types.ts';
import {
	installCompactCommandCheckpoint,
	publishAssistantCompletion,
} from '../../stream/finish-handler.ts';
import { autoCompactSessionAfterTurn } from '../runner/runner-errors.ts';
import {
	retryAfterMaxOutputTokensFinish,
	retryAfterProviderStreamIdleTimeout,
	shouldContinueAfterMaxOutputTokens,
} from '../runner/runner-retries.ts';
import { persistRunnerStreamFinishDetails } from '../runner/runner-finish-details.ts';
import {
	recordRunnerStreamEnd,
	type TurnDumpCollector,
} from '../runner/runner-dump.ts';
import type { createRunnerStreamHandlers } from '../runner/runner-handlers.ts';
import { markEmptyResponseAfterFinalAttempt } from '../runner/runner-empty-response.ts';
import type { RunnerTextState } from '../runner/runner-text.ts';
import type { RunnerToolObserverState } from '../runner/runner-tool-observer.ts';
import {
	completePendingAssistantMessage,
	type TurnTerminal,
} from './terminal.ts';
import type { RunSessionLoop } from './types.ts';

type StreamFinishSource = {
	finishReason: PromiseLike<string | undefined>;
	rawFinishReason: PromiseLike<string | undefined>;
	usage: PromiseLike<{ inputTokens?: number; outputTokens?: number }>;
};

async function settleUsage(result: StreamFinishSource | undefined) {
	if (!result) return undefined;
	try {
		return await result.usage;
	} catch {
		return undefined;
	}
}

/**
 * Decides and performs the single terminal transition for a turn. Ordering:
 * cancellation, then errors (retry classification before any failure write),
 * then finish (max-output continuation, empty response, success, and
 * post-turn auto-compaction).
 */
export async function finalizeTurn(args: {
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	terminal: TurnTerminal;
	handlers: ReturnType<typeof createRunnerStreamHandlers>;
	result: StreamFinishSource | undefined;
	runSessionLoop: RunSessionLoop;
	dump: TurnDumpCollector | null;
	textState: RunnerTextState;
	getStepIndex: () => number;
	firstToolSeen: () => boolean;
	toolObserver: RunnerToolObserverState;
	autoCompactThresholdTokens: number | null | undefined;
	turnStoppedForAutoCompact: () => boolean;
}): Promise<void> {
	const { opts, db, terminal, dump } = args;
	if (terminal.outcome()) return;
	if (
		terminal.facts.finish?.finishReason === 'error' &&
		terminal.primaryError() === undefined
	) {
		terminal.recordError(new Error('Assistant stream finished with an error'));
	}
	const primaryError = terminal.primaryError();
	const finished = terminal.facts.finish !== undefined && !primaryError;

	// 1. Cancellation wins unless the stream already finished cleanly.
	if (
		terminal.facts.persistenceError === undefined &&
		(opts.abortSignal?.aborted || terminal.facts.abort) &&
		!finished
	) {
		if (!terminal.claim('aborted')) return;
		recordRunnerStreamEnd({
			dump,
			textState: args.textState,
			stepIndex: args.getStepIndex(),
			finishReason: undefined,
			rawFinishReason: undefined,
			aborted: true,
		});
		await args.handlers.persistAbort(terminal.facts.abort ?? { steps: [] });
		return;
	}

	// 2. Errors: retry classification happens before any terminal write.
	if (primaryError !== undefined) {
		dump?.recordError(primaryError);
		logger.debug('[agent] assistant run failed', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			error: toErrorPayload(primaryError),
		});
		if (
			terminal.facts.persistenceError === undefined &&
			(await retryAfterProviderStreamIdleTimeout({
				err: primaryError,
				opts,
				db,
				runSessionLoop: args.runSessionLoop,
			}))
		) {
			terminal.claim('continued');
			return;
		}
		if (!terminal.claim('failed')) return;
		await args.handlers.persistError(primaryError);
		return;
	}

	// 3. Finish: continuation and empty-response decisions precede success.
	const fin = terminal.facts.finish ?? {};
	const { finishReason, rawFinishReason } =
		await persistRunnerStreamFinishDetails({
			result: args.result,
			fin: terminal.facts.finish,
			opts,
			db,
			firstToolSeen: args.firstToolSeen,
			toolObserver: args.toolObserver,
			textState: args.textState,
		});
	const finishEvent: FinishEvent = { ...fin, finishReason, rawFinishReason };
	recordRunnerStreamEnd({
		dump,
		textState: args.textState,
		stepIndex: args.getStepIndex(),
		finishReason,
		rawFinishReason,
		aborted: false,
	});

	if (
		shouldContinueAfterMaxOutputTokens({ opts, finishReason, rawFinishReason })
	) {
		if (!terminal.claim('continued')) return;
		if (
			!(await completePendingAssistantMessage({ db, opts, fin: finishEvent }))
		)
			return;
		await publishAssistantCompletion({
			opts,
			db,
			fin: finishEvent,
			notify: false,
		});
		await retryAfterMaxOutputTokensFinish({
			opts,
			db,
			finishReason,
			rawFinishReason,
			runSessionLoop: args.runSessionLoop,
		});
		return;
	}

	if (
		await markEmptyResponseAfterFinalAttempt({
			opts,
			db,
			finishReason,
			rawFinishReason,
			toolObserver: args.toolObserver,
		})
	) {
		terminal.claim('empty');
		return;
	}

	if (opts.isCompactCommand) {
		try {
			await installCompactCommandCheckpoint(opts, db, finishEvent);
		} catch (error) {
			if (!terminal.claim('failed')) return;
			await args.handlers.persistError(error);
			return;
		}
	}
	if (!terminal.claim('completed')) return;
	const stoppedForCompaction = args.turnStoppedForAutoCompact();
	if (!(await completePendingAssistantMessage({ db, opts, fin: finishEvent })))
		return;
	await publishAssistantCompletion({
		opts,
		db,
		fin: finishEvent,
		notify: !stoppedForCompaction,
	});

	await autoCompactSessionAfterTurn({
		db,
		opts,
		threshold: args.autoCompactThresholdTokens,
		turnStoppedForCompaction: stoppedForCompaction,
		lastStepUsage: await settleUsage(args.result),
		runSessionLoop: args.runSessionLoop,
	});
}
