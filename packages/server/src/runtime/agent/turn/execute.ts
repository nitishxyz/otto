import { stepCountIs } from 'ai';
import { isAnthropicBasedModel, logger } from '@ottocode/sdk';
import { flushPartContentWrites } from '../../persistence/part-content-writer.ts';
import type { RunOpts } from '../../session/queue.ts';
import { cleanupEmptyTextParts } from '../../session/db-operations.ts';
import { toErrorMessage } from '../../errors/handling.ts';
import { createOauthCodexTextGuardState } from '../../stream/text-guard.ts';
import type { AbortEvent, FinishEvent } from '../../stream/types.ts';
import {
	getModelLimits,
	resolveAutoCompactThresholdTokens,
} from '../../message/compaction.ts';
import { setupRunner } from '../runner/runner-setup.ts';
import { setupLazyToolLoading } from '../runner/runner-lazy-tools.ts';
import { withTodoReminderPrepareStep } from '../runner/runner-todo-reminder.ts';
import { withSubagentResultsPrepareStep } from '../runner/runner-subagent-results.ts';
import { withShellResultsPrepareStep } from '../runner/runner-shell-results.ts';
import {
	finalizeOpenReasoningStates,
	type ReasoningState,
} from '../runner/runner-reasoning.ts';
import {
	createFirstOutputLatencyLogger,
	logStreamRequestReady,
	nowMs,
} from '../runner/runner-telemetry.ts';
import type { RunnerTextState } from '../runner/runner-text.ts';
import { observeRunnerToolEvents } from '../runner/runner-tool-observer.ts';
import {
	createAutoCompactStopCondition,
	shouldPreemptivelyAutoCompact,
} from '../runner/runner-errors.ts';
import { consumeRunnerStreamParts } from '../runner/runner-stream-parts.ts';
import {
	createRunnerTurnDump,
	flushRunnerTurnDump,
} from '../runner/runner-dump.ts';
import { createRunnerStreamHandlers } from '../runner/runner-handlers.ts';
import { invokeRunnerStreamText } from '../runner/runner-invoke.ts';
import { ensureUserTurnBeforeAssistantRun } from '../runner/runner-messages.ts';
import { mapModelHistoryToolNames } from '../runner/runner-tool-registration.ts';
import { createTurnTerminal } from './terminal.ts';
import { finalizeTurn } from './finalize.ts';
import type { RunSessionLoop } from './types.ts';
import { findToolResultDurabilityError } from './durability.ts';

const MAX_TURN_STEPS = 1000;

type StreamResult = ReturnType<typeof invokeRunnerStreamText>;

/**
 * Runs one assistant turn: prepare → invoke → consume → decide → finalize.
 * AI SDK callbacks only record facts; this function performs exactly one
 * terminal transition per turn.
 */
export async function executeAssistantTurn(
	opts: RunOpts,
	runSessionLoop: RunSessionLoop,
	prepare: typeof setupRunner = setupRunner,
): Promise<void> {
	const runStartedAt = nowMs();
	const queueWaitMs = opts.queuedAt ? runStartedAt - opts.queuedAt : 0;
	const setup = await prepare(opts);
	const {
		cfg,
		db,
		history,
		system,
		additionalSystemMessages,
		model,
		effectiveMaxOutputTokens,
		sharedCtx,
		firstToolTimer,
		firstToolSeen,
		providerOptions,
		isOpenAIOAuth,
		timings,
	} = setup;
	const { toolset, prepareStep } = await setupLazyToolLoading(opts, setup);
	const prepareStepWithAsyncResults = withShellResultsPrepareStep(
		withSubagentResultsPrepareStep(withTodoReminderPrepareStep(prepareStep), {
			db,
			ctx: sharedCtx,
		}),
		{ db, ctx: sharedCtx },
	);

	const isFirstMessage = !history.some((m) => m.role === 'assistant');
	const runnerMessages = mapModelHistoryToolNames(
		[...additionalSystemMessages, ...history],
		setup.toolRegistration.canonicalToRegistration,
	);
	const nonEmptyRunnerMessages =
		runnerMessages.length === 0
			? ensureUserTurnBeforeAssistantRun(runnerMessages)
			: runnerMessages;
	const messagesWithSystemInstructions = isAnthropicBasedModel(
		opts.provider,
		opts.model,
	)
		? ensureUserTurnBeforeAssistantRun(nonEmptyRunnerMessages)
		: nonEmptyRunnerMessages;

	const dump = createRunnerTurnDump({
		opts,
		setup,
		messagesWithSystemInstructions,
		toolset: toolset as Record<string, unknown>,
		effectiveMaxOutputTokens,
		providerOptions,
		isOpenAIOAuth,
	});
	const logFirstOutputLatency = createFirstOutputLatencyLogger({
		opts,
		runStartedAt,
		queueWaitMs,
		timings,
	});

	const textState: RunnerTextState = {
		currentPartId: null,
		accumulated: '',
		latestAssistantText: '',
		lastTextDeltaStepIndex: null,
		firstPublishedDeltaSeen: false,
	};
	let stepIndex = 0;
	const getStepIndex = () => stepIndex;
	const incrementStepIndex = () => {
		stepIndex += 1;
		return stepIndex;
	};
	const oauthTextGuard = isOpenAIOAuth
		? createOauthCodexTextGuardState()
		: null;
	const handlers = createRunnerStreamHandlers({
		opts,
		db,
		cfg,
		sharedCtx,
		textState,
		isFirstMessage,
		getStepIndex,
		incrementStepIndex,
		runSessionLoop,
	});
	const terminal = createTurnTerminal();
	const reasoningStates = new Map<string, ReasoningState>();
	const toolObserver = observeRunnerToolEvents({
		sessionId: opts.sessionId,
		projectRoot: opts.projectRoot,
		messageId: opts.assistantMessageId,
		dump,
		getStepIndex,
		onToolCall: handlers.triggerTitleGenerationWhenReady,
	});

	const modelContextWindow =
		cfg.providers[opts.provider]?.models?.[opts.model]?.limit?.context ??
		getModelLimits(opts.provider, opts.model)?.context;
	const autoCompactThresholdTokens = resolveAutoCompactThresholdTokens({
		configuredThresholdTokens: cfg.defaults.autoCompactThresholdTokens,
		modelContextWindow,
	});
	let turnStoppedForAutoCompact = false;
	const autoCompactStop = createAutoCompactStopCondition(
		opts,
		autoCompactThresholdTokens,
		() => {
			turnStoppedForAutoCompact = true;
		},
	);
	const durabilityStop = ({ steps }: { steps: unknown[] }) => {
		const error = findToolResultDurabilityError(steps);
		if (error !== undefined) terminal.recordError(error);
		return terminal.facts.persistenceError !== undefined;
	};
	const stopWhen = [
		stepCountIs(MAX_TURN_STEPS),
		durabilityStop,
		...(autoCompactStop ? [autoCompactStop] : []),
	];
	const durabilityAbort = new AbortController();
	const abortSignal = opts.abortSignal
		? AbortSignal.any([opts.abortSignal, durabilityAbort.signal])
		: durabilityAbort.signal;
	const recordError = (error: unknown) => {
		terminal.recordError(error);
		if (terminal.facts.persistenceError !== undefined)
			durabilityAbort.abort(terminal.facts.persistenceError);
	};

	let result: StreamResult | undefined;
	try {
		try {
			if (
				await shouldPreemptivelyAutoCompact(
					db,
					opts,
					autoCompactThresholdTokens,
				)
			) {
				terminal.recordError(
					Object.assign(
						new Error('Configured auto-compaction threshold reached'),
						{ code: 'context_length_exceeded' },
					),
				);
			} else {
				logStreamRequestReady({
					opts,
					setup,
					queueWaitMs,
					messages: messagesWithSystemInstructions,
					toolset: toolset as Record<string, unknown>,
					hasPrepareStep: Boolean(prepareStepWithAsyncResults),
				});
				result = invokeRunnerStreamText({
					opts,
					model,
					toolset: toolset as Record<string, unknown>,
					system,
					messages: messagesWithSystemInstructions,
					effectiveMaxOutputTokens,
					providerOptions,
					abortSignal,
					stopWhen,
					prepareStep: prepareStepWithAsyncResults,
					onStepFinish: async (
						event: Parameters<typeof handlers.onStepFinish>[0],
					) => {
						const error = findToolResultDurabilityError(event);
						if (error !== undefined) {
							recordError(error);
							return;
						}
						await handlers.onStepFinish(event);
					},
					onError: recordError,
					onAbort: (event: AbortEvent) => terminal.recordAbort(event),
					onFinish: (event: FinishEvent) => terminal.recordFinish(event),
					queueWaitMs,
					setupMs: timings.totalMs,
				});
				await consumeRunnerStreamParts({
					fullStream: result.fullStream,
					opts,
					db,
					sharedCtx,
					textState,
					toolObserver: toolObserver.state,
					reasoningStates,
					oauthTextGuard,
					getStepIndex,
					firstToolSeen,
					logFirstOutputLatency,
					runStartedAt,
					queueWaitMs,
					setupMs: timings.totalMs,
					dump,
					onStreamError: recordError,
				});
			}
		} catch (error) {
			terminal.recordError(error);
		} finally {
			toolObserver.unsubscribe();
		}

		try {
			await finalizeOpenReasoningStates(db, reasoningStates);
			await handlers.flushTextPart();
			await flushPartContentWrites();
			await cleanupEmptyTextParts(opts, db);
		} catch (error) {
			terminal.recordPersistenceError(error);
			logger.warn('[agent] failed to flush turn content', {
				sessionId: opts.sessionId,
				messageId: opts.assistantMessageId,
				error: toErrorMessage(error),
			});
		}
		firstToolTimer.end({ seen: firstToolSeen() });

		await finalizeTurn({
			opts,
			db,
			terminal,
			handlers,
			result,
			runSessionLoop,
			dump,
			textState,
			getStepIndex,
			firstToolSeen,
			toolObserver: toolObserver.state,
			autoCompactThresholdTokens,
			turnStoppedForAutoCompact: () => turnStoppedForAutoCompact,
		});
	} finally {
		toolObserver.unsubscribe();
		await flushRunnerTurnDump({
			dump,
			projectRoot: cfg.projectRoot,
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
		});
	}
}
