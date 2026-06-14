import { stepCountIs, streamText } from 'ai';
import { logger } from '@ottocode/sdk';
import type { getDb } from '@ottocode/database';
import { messages } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../events/bus.ts';
import {
	type RunOpts,
	enqueueAssistantRun,
	setRunning,
	dequeueJob,
	cleanupSession,
	isSendNowPreemptReason,
	isSystemAbortReason,
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
	buildLazyPrepareStep,
	collectLoadedToolsFromHistory,
	collectLoadedToolsFromSession,
	createLazyPrepareStepState,
	createLazyToolLoaderState,
} from './lazy-prepare-step.ts';
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
	sendQueuedMessageNow,
	getQueueState,
	getRunnerState,
} from '../session/queue.ts';

const OPENAI_OAUTH_CODEX_STREAM_IDLE_RETRY_MAX = 2;
const MAX_OUTPUT_CONTINUATION_RETRY_MAX = 2;
const MAX_TURN_STEPS = 1000;

function parsePositiveIntegerEnv(name: string, fallback: number) {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getOpenAIOAuthCodexStreamIdleRetryMax() {
	return parsePositiveIntegerEnv(
		'OTTO_OPENAI_OAUTH_STREAM_IDLE_RETRY_MAX',
		OPENAI_OAUTH_CODEX_STREAM_IDLE_RETRY_MAX,
	);
}

function getMaxOutputContinuationRetryMax() {
	return parsePositiveIntegerEnv(
		'OTTO_MAX_OUTPUT_CONTINUATION_RETRY_MAX',
		MAX_OUTPUT_CONTINUATION_RETRY_MAX,
	);
}

function isMaxOutputTokensFinish(
	finishReason: string | undefined,
	rawFinishReason: string | undefined,
): boolean {
	const normalizedFinish = finishReason?.toLowerCase() ?? '';
	const normalizedRaw = rawFinishReason?.toLowerCase() ?? '';
	return (
		normalizedRaw === 'max_output_tokens' ||
		normalizedRaw === 'max_tokens' ||
		normalizedRaw === 'length' ||
		(normalizedFinish === 'length' &&
			(normalizedRaw === '' || normalizedRaw.includes('token')))
	);
}

function isOpenAIOAuthCodexStreamIdleTimeout(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('OpenAI OAuth Codex stream idle timeout');
}

async function retryOpenAIOAuthCodexAfterStreamIdleTimeout(args: {
	err: unknown;
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	isOpenAIOAuth: boolean;
}): Promise<boolean> {
	const { err, opts, db, isOpenAIOAuth } = args;
	if (opts.provider !== 'openai' || !isOpenAIOAuth) return false;
	if (!isOpenAIOAuthCodexStreamIdleTimeout(err)) return false;
	if (opts.abortSignal?.aborted) return false;

	const continuationCount = opts.continuationCount ?? 0;
	const maxRetries = getOpenAIOAuthCodexStreamIdleRetryMax();
	if (continuationCount >= maxRetries) return false;

	const retryMessageId = crypto.randomUUID();
	await cleanupEmptyTextParts(opts, db);
	await db
		.update(messages)
		.set({
			status: 'complete',
			completedAt: Date.now(),
			finishReason: 'stream-idle-retry',
		})
		.where(eq(messages.id, opts.assistantMessageId));
	publish({
		type: 'message.completed',
		sessionId: opts.sessionId,
		payload: {
			id: opts.assistantMessageId,
			finishReason: 'stream-idle-retry',
			codexStreamRetry: true,
		},
	});

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
			codexStreamRetry: true,
		},
	});

	const { abortSignal: _abortSignal, queuedAt: _queuedAt, ...retryOpts } = opts;
	enqueueAssistantRun(
		{
			...retryOpts,
			assistantMessageId: retryMessageId,
			continuationCount: continuationCount + 1,
		},
		runSessionLoop,
	);
	logger.warn(
		'[agent] retrying OpenAI OAuth Codex run after stream idle timeout',
		{
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			retryMessageId,
			agent: opts.agent,
			model: opts.model,
			attempt: continuationCount + 1,
			maxRetries,
			error: err instanceof Error ? err.message : String(err),
		},
	);
	return true;
}

async function retryAfterMaxOutputTokensFinish(args: {
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	finishReason: string | undefined;
	rawFinishReason: string | undefined;
}): Promise<boolean> {
	const { opts, db, finishReason, rawFinishReason } = args;
	if (!isMaxOutputTokensFinish(finishReason, rawFinishReason)) return false;
	if (opts.abortSignal?.aborted) return false;
	if (opts.isCompactCommand) return false;

	const continuationCount = opts.continuationCount ?? 0;
	const maxRetries = getMaxOutputContinuationRetryMax();
	if (continuationCount >= maxRetries) return false;

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
			maxOutputContinuation: true,
		},
	});

	const { abortSignal: _abortSignal, queuedAt: _queuedAt, ...retryOpts } = opts;
	enqueueAssistantRun(
		{
			...retryOpts,
			assistantMessageId: retryMessageId,
			continuationCount: continuationCount + 1,
		},
		runSessionLoop,
		{ front: true },
	);
	logger.warn('[agent] continuing run after max output token finish', {
		sessionId: opts.sessionId,
		messageId: opts.assistantMessageId,
		retryMessageId,
		agent: opts.agent,
		provider: opts.provider,
		model: opts.model,
		finishReason,
		rawFinishReason,
		attempt: continuationCount + 1,
		maxRetries,
	});
	return true;
}

function buildCanonicalRegistrationMap(
	canonicalRecord: Record<string, unknown>,
	adaptedRecord: Record<string, unknown>,
): Record<string, string> {
	const registrationKeys = Object.keys(adaptedRecord);
	const canonicalToRegistration: Record<string, string> = {};
	for (const canonical of Object.keys(canonicalRecord)) {
		const regName = registrationKeys.find(
			(k) =>
				k === canonical ||
				k.toLowerCase().replace(/_/g, '') ===
					canonical.toLowerCase().replace(/_/g, ''),
		);
		canonicalToRegistration[canonical] = regName ?? canonical;
	}
	return canonicalToRegistration;
}

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
		} catch {}
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
		lazyToolsRecord,
		mcpToolsRecord,
		timings,
	} = setup;
	let { toolset } = setup;

	const hasLazyTools = Object.keys(lazyToolsRecord).length > 0;
	const hasMCPTools = Object.keys(mcpToolsRecord).length > 0;
	let prepareStep: ReturnType<typeof buildLazyPrepareStep> | undefined;

	if (hasLazyTools || hasMCPTools) {
		const baseToolNames = Object.keys(toolset);
		const { getAuth: getAuthFn } = await import('@ottocode/sdk');
		const providerAuth = await getAuthFn(opts.provider, cfg.projectRoot);
		const loaders = [];
		const collectInitialLoadedTools = async (loadToolRegName: string) =>
			Array.from(
				new Set([
					...collectLoadedToolsFromHistory(history, loadToolRegName),
					...(await collectLoadedToolsFromSession(
						db,
						opts.sessionId,
						loadToolRegName,
					)),
				]),
			);

		if (hasLazyTools) {
			const adaptedLazy = adaptToolsFn(
				Object.entries(lazyToolsRecord).map(([name, tool]) => ({ name, tool })),
				sharedCtx,
				opts.provider,
				providerAuth?.type,
			);
			toolset = { ...toolset, ...adaptedLazy };
			const canonicalToRegistration = buildCanonicalRegistrationMap(
				lazyToolsRecord,
				adaptedLazy,
			);
			const loadToolRegName =
				Object.keys(toolset).find(
					(k) =>
						k === 'load_tools' ||
						k.toLowerCase().replace(/_/g, '') === 'loadtools',
				) ?? 'load_tools';
			loaders.push(
				createLazyToolLoaderState(
					lazyToolsRecord,
					canonicalToRegistration,
					loadToolRegName,
					await collectInitialLoadedTools(loadToolRegName),
				),
			);
		}

		if (hasMCPTools) {
			const adaptedMCP = adaptToolsFn(
				Object.entries(mcpToolsRecord).map(([name, tool]) => ({ name, tool })),
				sharedCtx,
				opts.provider,
				providerAuth?.type,
			);
			toolset = { ...toolset, ...adaptedMCP };
			const canonicalToRegistration = buildCanonicalRegistrationMap(
				mcpToolsRecord,
				adaptedMCP,
			);
			const loadToolRegName =
				Object.keys(toolset).find(
					(k) =>
						k === 'load_mcp_tools' ||
						k.toLowerCase().replace(/_/g, '') === 'loadmcptools',
				) ?? 'load_mcp_tools';
			loaders.push(
				createLazyToolLoaderState(
					mcpToolsRecord,
					canonicalToRegistration,
					loadToolRegName,
					await collectInitialLoadedTools(loadToolRegName),
				),
			);
		}

		prepareStep = buildLazyPrepareStep(
			createLazyPrepareStepState(baseToolNames, loaders),
		);
	}

	const isFirstMessage = !history.some((m) => m.role === 'assistant');

	const messagesWithSystemInstructions = [
		...additionalSystemMessages,
		...history,
	];

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
	let sendNowPreemptHandled = false;
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
		const abortReason = (
			opts.abortSignal as (AbortSignal & { reason?: unknown }) | undefined
		)?.reason;
		const isSendNowPreempt = isSendNowPreemptReason(abortReason);
		_abortedByUser = !isSendNowPreempt && !isSystemAbortReason(abortReason);
		await baseOnAbort(event);
		sendNowPreemptHandled = isSendNowPreempt;
	};

	const onFinish = createFinishHandler(opts, db, completeAssistantMessage);
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
		if (!fs) {
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

		try {
			const existingRows = await db
				.select({ finishDetails: messages.finishDetails })
				.from(messages)
				.where(eq(messages.id, opts.assistantMessageId))
				.limit(1);
			let finishDetails: Record<string, unknown> = {};
			try {
				finishDetails = existingRows[0]?.finishDetails
					? JSON.parse(existingRows[0].finishDetails)
					: {};
			} catch {
				finishDetails = {};
			}
			await db
				.update(messages)
				.set({
					finishReason: streamFinishReason,
					rawFinishReason: streamRawFinishReason,
					finishDetails: JSON.stringify({
						...finishDetails,
						stream: {
							firstToolSeen: firstToolSeen(),
							lastToolName: toolObserver.state.lastToolName,
							endedWithToolActivity: toolObserver.state.endedWithToolActivity,
							hasTrailingAssistantText:
								(textState.latestAssistantText || textState.accumulated).trim()
									.length > 0,
							continuationCount: opts.continuationCount ?? 0,
						},
					}),
				})
				.where(eq(messages.id, opts.assistantMessageId));
		} catch {}

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
				aborted: _abortedByUser,
			});
		}

		await retryAfterMaxOutputTokensFinish({
			opts,
			db,
			finishReason: streamFinishReason,
			rawFinishReason: streamRawFinishReason,
		});
	} catch (err) {
		unsubscribeFinish();
		const isSendNowPreempt = isSendNowPreemptReason(
			(opts.abortSignal as (AbortSignal & { reason?: unknown }) | undefined)
				?.reason,
		);
		if (isSendNowPreempt) {
			if (!sendNowPreemptHandled) {
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
			})
		) {
			return;
		}
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
