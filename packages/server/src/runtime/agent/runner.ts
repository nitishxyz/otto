import { hasToolCall, streamText } from 'ai';
import { logger } from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import {
	type RunOpts,
	setRunning,
	dequeueJob,
	cleanupSession,
} from '../session/queue.ts';
import {
	updateSessionTokensIncremental,
	updateMessageTokensIncremental,
	completeAssistantMessage,
	cleanupEmptyTextParts,
} from '../session/db-operations.ts';
import {
	createStepFinishHandler,
	createErrorHandler,
	createAbortHandler,
	createFinishHandler,
} from '../stream/handlers.ts';
import { triggerDeferredTitleGeneration } from '../message/service.ts';
import { setupRunner } from './runner-setup.ts';
import {
	createMCPPrepareStepState,
	buildPrepareStep,
} from './mcp-prepare-step.ts';
import { adaptTools as adaptToolsFn } from '../../tools/adapter.ts';
import {
	type ReasoningState,
	handleReasoningStart,
	handleReasoningDelta,
	handleReasoningEnd,
} from './runner-reasoning.ts';
import {
	createOauthCodexTextGuardState,
	consumeOauthCodexTextDelta,
} from '../stream/text-guard.ts';
import { createTurnDumpCollector } from '../debug/turn-dump.ts';
import {
	appendRunnerReminderMessages,
	type RunnerMessage,
} from './runner-reminders.ts';
import {
	createFirstOutputLatencyLogger,
	logStreamRequestReady,
	nowMs,
} from './runner-telemetry.ts';
import { handleRunnerTextDelta, type RunnerTextState } from './runner-text.ts';
import { observeRunnerToolEvents } from './runner-tool-observer.ts';
import {
	handleRunnerError,
	shouldPreemptivelyAutoCompact,
} from './runner-errors.ts';
import { markUnhandledAssistantRunFailure } from './runner-failures.ts';

export {
	enqueueAssistantRun,
	abortSession,
	abortMessage,
	removeFromQueue,
	getQueueState,
	getRunnerState,
} from '../session/queue.ts';

export async function runSessionLoop(sessionId: string) {
	setRunning(sessionId, true);

	while (true) {
		const job = await dequeueJob(sessionId);
		if (!job) break;

		try {
			await runAssistant(job);
		} catch (err) {
			await markUnhandledAssistantRunFailure(job, err);
		}
	}

	setRunning(sessionId, false);
	cleanupSession(sessionId);
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
		mcpToolsRecord,
		timings,
	} = setup;
	let { toolset } = setup;

	const hasMCPTools = Object.keys(mcpToolsRecord).length > 0;
	let prepareStep: ReturnType<typeof buildPrepareStep> | undefined;

	if (hasMCPTools) {
		const baseToolNames = Object.keys(toolset);
		const { getAuth: getAuthFn } = await import('@ottocode/sdk');
		const providerAuth = await getAuthFn(opts.provider, cfg.projectRoot);
		const adaptedMCP = adaptToolsFn(
			Object.entries(mcpToolsRecord).map(([name, tool]) => ({ name, tool })),
			sharedCtx,
			opts.provider,
			providerAuth?.type,
		);
		toolset = { ...toolset, ...adaptedMCP };
		const canonicalToRegistration: Record<string, string> = {};
		for (const canonical of Object.keys(mcpToolsRecord)) {
			const regKeys = Object.keys(adaptedMCP);
			const regName = regKeys.find(
				(k) =>
					k === canonical ||
					k.toLowerCase().replace(/_/g, '') ===
						canonical.toLowerCase().replace(/_/g, ''),
			);
			canonicalToRegistration[canonical] = regName ?? canonical;
		}
		const loadToolRegName =
			Object.keys(toolset).find(
				(k) =>
					k === 'load_mcp_tools' ||
					k.toLowerCase().replace(/_/g, '') === 'loadmcptools',
			) ?? 'load_mcp_tools';
		const mcpState = createMCPPrepareStepState(
			mcpToolsRecord,
			baseToolNames,
			canonicalToRegistration,
			loadToolRegName,
		);
		prepareStep = buildPrepareStep(mcpState);
	}

	const isFirstMessage = !history.some((m) => m.role === 'assistant');

	const messagesWithSystemInstructions: RunnerMessage[] = [
		...additionalSystemMessages,
		...history,
	];
	appendRunnerReminderMessages({
		messages: messagesWithSystemInstructions,
		isFirstMessage,
		isOpenAIOAuth,
		continuationCount: opts.continuationCount,
	});

	const dump = createTurnDumpCollector({
		sessionId: opts.sessionId,
		messageId: opts.assistantMessageId,
		provider: opts.provider,
		model: opts.model,
		agent: opts.agent,
		continuationCount: opts.continuationCount,
	});
	if (dump) {
		dump.setSystemPrompt(system, setup.systemComponents);
		dump.setAdditionalSystemMessages(
			additionalSystemMessages as Array<{ role: string; content: string }>,
		);
		dump.setHistory(history as Array<{ role: string; content: unknown }>);
		dump.setFinalMessages(messagesWithSystemInstructions);
		dump.setTools(toolset);
		dump.setModelConfig({
			maxOutputTokens: setup.maxOutputTokens,
			effectiveMaxOutputTokens,
			providerOptions,
			isOpenAIOAuth,
			needsSpoof: setup.needsSpoof,
		});
	}

	let _abortedByUser = false;
	let titleGenerationTriggered = false;
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

	const getCurrentPartId = () => textState.currentPartId;
	const getStepIndex = () => stepIndex;
	const updateCurrentPartId = (id: string | null) => {
		textState.currentPartId = id;
	};
	const updateAccumulated = (text: string) => {
		textState.accumulated = text;
	};
	const incrementStepIndex = () => {
		stepIndex += 1;
		return stepIndex;
	};
	const triggerTitleGenerationWhenReady = () => {
		if (titleGenerationTriggered) {
			return;
		}

		titleGenerationTriggered = true;
		if (!isFirstMessage) {
			return;
		}

		void triggerDeferredTitleGeneration({
			cfg,
			db,
			sessionId: opts.sessionId,
		});
	};
	const toolObserver = observeRunnerToolEvents({
		sessionId: opts.sessionId,
		dump,
		getStepIndex,
		onToolCall: triggerTitleGenerationWhenReady,
	});
	const unsubscribeFinish = toolObserver.unsubscribe;

	const reasoningStates = new Map<string, ReasoningState>();

	const onStepFinish = createStepFinishHandler(
		opts,
		db,
		getStepIndex,
		incrementStepIndex,
		getCurrentPartId,
		updateCurrentPartId,
		updateAccumulated,
		triggerTitleGenerationWhenReady,
		sharedCtx,
		updateSessionTokensIncremental,
		updateMessageTokensIncremental,
	);

	const onError = createErrorHandler(
		opts,
		db,
		getStepIndex,
		sharedCtx,
		runSessionLoop,
	);

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
		await onError(autoCompactError);
		unsubscribeFinish();
		return;
	}

	const baseOnAbort = createAbortHandler(opts, db, getStepIndex, sharedCtx);
	const onAbort = async (event: Parameters<typeof baseOnAbort>[0]) => {
		_abortedByUser = true;
		await baseOnAbort(event);
	};

	const onFinish = createFinishHandler(opts, db, completeAssistantMessage);
	const isCopilotResponsesApi =
		opts.provider === 'copilot' && !opts.model.startsWith('gpt-5-mini');
	const stopWhenCondition = isCopilotResponsesApi
		? undefined
		: hasToolCall('finish');
	logStreamRequestReady({
		opts,
		setup,
		queueWaitMs,
		messages: messagesWithSystemInstructions,
		toolset: toolset as Record<string, unknown>,
		hasPrepareStep: Boolean(prepareStep),
	});

	try {
		const streamInvocationStartedAt = nowMs();
		logger.info('[latency] streamText invoke', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			queueWaitMs,
			setupMs: timings.totalMs,
		});
		const result = streamText({
			model,
			tools: toolset,
			...(system ? { system } : {}),
			// biome-ignore lint/suspicious/noExplicitAny: AI SDK message types are complex
			messages: messagesWithSystemInstructions as any,
			...(effectiveMaxOutputTokens
				? { maxOutputTokens: effectiveMaxOutputTokens }
				: {}),
			...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
			abortSignal: opts.abortSignal,
			stopWhen: stopWhenCondition,
			...(prepareStep ? { prepareStep } : {}),
			// biome-ignore lint/suspicious/noExplicitAny: AI SDK callback types mismatch
			onStepFinish: onStepFinish as any,
			// biome-ignore lint/suspicious/noExplicitAny: AI SDK callback types mismatch
			onError: onError as any,
			// biome-ignore lint/suspicious/noExplicitAny: AI SDK callback types mismatch
			onAbort: onAbort as any,
			// biome-ignore lint/suspicious/noExplicitAny: AI SDK callback types mismatch
			onFinish: onFinish as any,
			// biome-ignore lint/suspicious/noExplicitAny: AI SDK streamText options type
		} as any);
		logger.info('[latency] streamText returned', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			invokeMs: nowMs() - streamInvocationStartedAt,
		});
		let firstFullStreamPartSeen = false;

		for await (const part of result.fullStream) {
			if (!part) continue;
			if (!firstFullStreamPartSeen) {
				firstFullStreamPartSeen = true;
				logger.info('[latency] first fullStream part', {
					sessionId: opts.sessionId,
					messageId: opts.assistantMessageId,
					agent: opts.agent,
					provider: opts.provider,
					model: opts.model,
					partType: part.type,
					sinceRunStartMs: nowMs() - runStartedAt,
					queueWaitMs,
					setupMs: timings.totalMs,
				});
			}

			if (part.type === 'tool-input-start') {
				continue;
			}

			if (part.type === 'tool-input-delta') {
				continue;
			}

			if (part.type === 'tool-input-end') {
				continue;
			}

			if (part.type === 'tool-call') {
				continue;
			}

			if (part.type === 'tool-result') {
				continue;
			}

			if (part.type === 'text-delta') {
				const rawDelta = part.text;
				if (!rawDelta) continue;

				const delta = oauthTextGuard
					? consumeOauthCodexTextDelta(oauthTextGuard, rawDelta)
					: rawDelta;
				if (!delta) continue;

				await handleRunnerTextDelta({
					delta,
					state: textState,
					toolObserver: toolObserver.state,
					opts,
					db,
					sharedCtx,
					stepIndex,
					dump,
					firstToolSeen,
					logFirstOutputLatency,
					runStartedAt,
					queueWaitMs,
					setupMs: timings.totalMs,
				});
				continue;
			}

			if (part.type === 'reasoning-start') {
				const reasoningId = part.id;
				if (!reasoningId) continue;
				await handleReasoningStart(
					reasoningId,
					part.providerMetadata,
					opts,
					db,
					sharedCtx,
					getStepIndex,
					reasoningStates,
				);
				continue;
			}

			if (part.type === 'reasoning-delta') {
				if (part.text) {
					logFirstOutputLatency('reasoning');
				}
				await handleReasoningDelta(
					part.id,
					part.text,
					part.providerMetadata,
					opts,
					db,
					sharedCtx,
					getStepIndex,
					reasoningStates,
				);
				continue;
			}

			if (part.type === 'reasoning-end') {
				await handleReasoningEnd(part.id, db, reasoningStates);
			}
		}

		const fs = firstToolSeen();
		if (!fs && !toolObserver.state.finishObserved) {
			publish({
				type: 'finish-step',
				sessionId: opts.sessionId,
				payload: { reason: 'no-tool-calls' },
			});
		}

		unsubscribeFinish();
		await cleanupEmptyTextParts(opts, db);
		firstToolTimer.end({ seen: firstToolSeen() });

		let streamFinishReason: string | undefined;
		try {
			streamFinishReason = await result.finishReason;
		} catch {
			streamFinishReason = undefined;
		}

		let streamRawFinishReason: string | undefined;
		try {
			streamRawFinishReason = await result.rawFinishReason;
		} catch {
			streamRawFinishReason = undefined;
		}

		if (dump) {
			const finalTextSnapshot =
				textState.latestAssistantText || textState.accumulated;
			if (finalTextSnapshot.length > 0) {
				dump.recordTextDelta(
					textState.lastTextDeltaStepIndex ?? stepIndex,
					finalTextSnapshot,
					{ force: true },
				);
			}
			dump.recordStreamEnd({
				finishReason: streamFinishReason,
				rawFinishReason: streamRawFinishReason,
				finishObserved: toolObserver.state.finishObserved,
				aborted: _abortedByUser,
			});
		}
	} catch (err) {
		unsubscribeFinish();
		dump?.recordError(err);
		logger.warn('[agent] assistant run failed', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			error:
				err instanceof Error
					? { name: err.name, message: err.message }
					: { message: String(err) },
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
		if (dump) {
			try {
				await dump.flush(cfg.projectRoot);
			} catch {}
		}
	}
}
