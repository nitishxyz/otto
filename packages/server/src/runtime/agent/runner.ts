import { stepCountIs } from 'ai';
import { logger } from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import {
	type RunOpts,
	setRunning,
	dequeueJob,
	cleanupSession,
	isSendNowPreemptReason,
} from '../session/queue.ts';
import {
	updateSessionTokensIncremental,
	updateMessageTokensIncremental,
	completeAssistantMessage,
	cleanupEmptyTextParts,
} from '../session/db-operations.ts';
import { toErrorPayload } from '../errors/handling.ts';
import { setupRunner } from './runner/runner-setup.ts';
import { setupLazyToolLoading } from './runner/runner-lazy-tools.ts';
import type { ReasoningState } from './runner/runner-reasoning.ts';
import { createOauthCodexTextGuardState } from '../stream/text-guard.ts';
import {
	createFirstOutputLatencyLogger,
	logStreamRequestReady,
	nowMs,
} from './runner/runner-telemetry.ts';
import type { RunnerTextState } from './runner/runner-text.ts';
import { observeRunnerToolEvents } from './runner/runner-tool-observer.ts';
import {
	handleRunnerError,
	shouldPreemptivelyAutoCompact,
} from './runner/runner-errors.ts';
import { markUnhandledAssistantRunFailure } from './runner/runner-failures.ts';
import {
	retryAfterMaxOutputTokensFinish,
	retryOpenAIOAuthCodexAfterStreamIdleTimeout,
} from './runner/runner-retries.ts';
import { consumeRunnerStreamParts } from './runner/runner-stream-parts.ts';
import { persistRunnerStreamFinishDetails } from './runner/runner-finish-details.ts';
import {
	createRunnerTurnDump,
	flushRunnerTurnDump,
	recordRunnerStreamEnd,
} from './runner/runner-dump.ts';
import { createRunnerStreamHandlers } from './runner/runner-handlers.ts';
import { invokeRunnerStreamText } from './runner/runner-invoke.ts';

export {
	enqueueAssistantRun,
	abortSession,
	abortMessage,
	removeFromQueue,
	sendQueuedMessageNow,
	getQueueState,
	getRunnerState,
} from '../session/queue.ts';

const MAX_TURN_STEPS = 1000;

export async function runSessionLoop(sessionId: string) {
	setRunning(sessionId, true);

	let lastProjectRoot: string | undefined;
	while (true) {
		const job = await dequeueJob(sessionId);
		if (!job) break;
		lastProjectRoot = job.projectRoot;

		try {
			await runAssistant(job);
		} catch (err) {
			await markUnhandledAssistantRunFailure(job, err);
		}
	}

	setRunning(sessionId, false);
	cleanupSession(sessionId);

	if (lastProjectRoot) {
		try {
			const { handleSessionIdle } = await import('../subagents/idle.ts');
			void handleSessionIdle(sessionId, lastProjectRoot);
		} catch (error) {
			logger.debug('[agent] failed to schedule session idle handler', {
				sessionId,
				projectRoot: lastProjectRoot,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

async function runAssistant(opts: RunOpts) {
	const runStartedAt = nowMs();
	const queueWaitMs = opts.queuedAt ? runStartedAt - opts.queuedAt : 0;
	const setup = await setupRunner(opts);
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

	const isFirstMessage = !history.some((m) => m.role === 'assistant');

	const messagesWithSystemInstructions = [
		...additionalSystemMessages,
		...history,
	];

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
	const oauthTextGuard = isOpenAIOAuth
		? createOauthCodexTextGuardState()
		: null;

	const getStepIndex = () => stepIndex;
	const incrementStepIndex = () => {
		stepIndex += 1;
		return stepIndex;
	};
	const runnerHandlers = createRunnerStreamHandlers({
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
	const toolObserver = observeRunnerToolEvents({
		sessionId: opts.sessionId,
		dump,
		getStepIndex,
		onToolCall: runnerHandlers.triggerTitleGenerationWhenReady,
	});
	const unsubscribeFinish = toolObserver.unsubscribe;

	const reasoningStates = new Map<string, ReasoningState>();

	if (
		await shouldPreemptivelyAutoCompact(
			db,
			opts,
			cfg.defaults.autoCompactThresholdTokens,
		)
	) {
		const autoCompactError = Object.assign(
			new Error('Configured auto-compaction threshold reached'),
			{ code: 'context_length_exceeded' },
		);
		await runnerHandlers.onError(autoCompactError);
		unsubscribeFinish();
		return;
	}

	const isCopilotResponsesApi =
		opts.provider === 'copilot' && !opts.model.startsWith('gpt-5-mini');
	const stopWhenCondition = isCopilotResponsesApi
		? undefined
		: stepCountIs(MAX_TURN_STEPS);
	logStreamRequestReady({
		opts,
		setup,
		queueWaitMs,
		messages: messagesWithSystemInstructions,
		toolset: toolset as Record<string, unknown>,
		hasPrepareStep: Boolean(prepareStep),
	});

	try {
		const result = invokeRunnerStreamText({
			opts,
			model,
			toolset: toolset as Record<string, unknown>,
			system,
			messages: messagesWithSystemInstructions,
			effectiveMaxOutputTokens,
			providerOptions,
			abortSignal: opts.abortSignal,
			stopWhen: stopWhenCondition,
			prepareStep,
			onStepFinish: runnerHandlers.onStepFinish,
			onError: runnerHandlers.onError,
			onAbort: runnerHandlers.onAbort,
			onFinish: runnerHandlers.onFinish,
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
		});

		unsubscribeFinish();
		await cleanupEmptyTextParts(opts, db);
		firstToolTimer.end({ seen: firstToolSeen() });
		const { finishReason, rawFinishReason } =
			await persistRunnerStreamFinishDetails({
				result,
				opts,
				db,
				firstToolSeen,
				toolObserver: toolObserver.state,
				textState,
			});

		recordRunnerStreamEnd({
			dump,
			textState,
			stepIndex,
			finishReason,
			rawFinishReason,
			aborted: runnerHandlers.getAbortedByUser(),
		});

		await retryAfterMaxOutputTokensFinish({
			opts,
			db,
			finishReason,
			rawFinishReason,
			runSessionLoop,
		});
	} catch (err) {
		unsubscribeFinish();
		const isSendNowPreempt = isSendNowPreemptReason(
			(opts.abortSignal as (AbortSignal & { reason?: unknown }) | undefined)
				?.reason,
		);
		if (isSendNowPreempt) {
			if (!runnerHandlers.getSendNowPreemptHandled()) {
				await completeAssistantMessage({ finishReason: 'preempted' }, opts, db);
				publish({
					type: 'message.completed',
					sessionId: opts.sessionId,
					payload: {
						id: opts.assistantMessageId,
						finishReason: 'preempted',
					},
				});
			}
			return;
		}
		if (
			await retryOpenAIOAuthCodexAfterStreamIdleTimeout({
				err,
				opts,
				db,
				isOpenAIOAuth,
				runSessionLoop,
			})
		) {
			return;
		}
		dump?.recordError(err);
		const errorPayload = toErrorPayload(err);
		logger.debug('[agent] assistant run failed', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			error: errorPayload,
		});
		const outcome = await handleRunnerError({
			err,
			opts,
			db,
			completeAssistantMessage,
			updateSessionTokensIncremental,
			updateMessageTokensIncremental,
			nextPartIndex: sharedCtx.nextIndex,
		});
		if (outcome === 'handled') return;
		throw err;
	} finally {
		await flushRunnerTurnDump({
			dump,
			projectRoot: cfg.projectRoot,
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
		});
	}
}
