import { isProviderStreamIdleTimeoutError, logger } from '@ottocode/sdk';
import type { getDb } from '@ottocode/database';
import { publish } from '../../../events/bus.ts';
import type { RunOpts } from '../../session/queue.ts';
import { cleanupEmptyTextParts } from '../../session/db-operations.ts';
import { toErrorMessage } from '../../errors/handling.ts';
import {
	claimPendingMessage,
	isRunCancelled,
	scheduleContinuation,
} from '../turn/continuation.ts';
import type { RunSessionLoop } from '../turn/types.ts';

const PROVIDER_STREAM_IDLE_RETRY_MAX = 2;
const MAX_OUTPUT_CONTINUATION_RETRY_MAX = 2;

function parsePositiveIntegerEnv(name: string, fallback: number) {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getProviderStreamIdleRetryMax() {
	return parsePositiveIntegerEnv(
		'OTTO_PROVIDER_STREAM_IDLE_RETRY_MAX',
		parsePositiveIntegerEnv(
			'OTTO_OPENAI_OAUTH_STREAM_IDLE_RETRY_MAX',
			PROVIDER_STREAM_IDLE_RETRY_MAX,
		),
	);
}

function getMaxOutputContinuationRetryMax() {
	return parsePositiveIntegerEnv(
		'OTTO_MAX_OUTPUT_CONTINUATION_RETRY_MAX',
		MAX_OUTPUT_CONTINUATION_RETRY_MAX,
	);
}

export function isMaxOutputTokensFinish(
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

export function isProviderOrLegacyCodexStreamIdleTimeout(
	error: unknown,
): boolean {
	if (isProviderStreamIdleTimeoutError(error)) return true;
	const message = toErrorMessage(error);
	return (
		message.includes('OpenAI OAuth Codex stream idle timeout') ||
		message.includes('OpenAI OAuth Codex WebSocket')
	);
}

/** Whether a stream idle timeout should be retried for this run. */
export function shouldRetryProviderStreamIdleTimeout(
	err: unknown,
	opts: RunOpts,
): boolean {
	if (!isProviderOrLegacyCodexStreamIdleTimeout(err)) return false;
	if (isRunCancelled(opts)) return false;
	return (opts.streamIdleRetryCount ?? 0) < getProviderStreamIdleRetryMax();
}

export async function retryAfterProviderStreamIdleTimeout(args: {
	err: unknown;
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	runSessionLoop: RunSessionLoop;
}): Promise<boolean> {
	const { err, opts, db, runSessionLoop } = args;
	if (!shouldRetryProviderStreamIdleTimeout(err, opts)) return false;

	const streamIdleRetryCount = opts.streamIdleRetryCount ?? 0;
	await cleanupEmptyTextParts(opts, db);
	const claimed = await claimPendingMessage(db, opts.assistantMessageId, {
		status: 'complete',
		completedAt: Date.now(),
		finishReason: 'stream-idle-retry',
	});
	if (!claimed) return true;
	publish({
		type: 'message.completed',
		sessionId: opts.sessionId,
		projectId: opts.projectId,
		projectRoot: opts.projectRoot,
		payload: {
			id: opts.assistantMessageId,
			finishReason: 'stream-idle-retry',
			providerStreamRetry: true,
		},
	});

	const retryMessageId = await scheduleContinuation({
		db,
		opts,
		kind: 'stream-idle-retry',
		counters: { streamIdleRetryCount: streamIdleRetryCount + 1 },
		runSessionLoop,
		createdPayload: { providerStreamRetry: true },
	});
	logger.warn('[agent] retrying provider run after stream idle timeout', {
		sessionId: opts.sessionId,
		messageId: opts.assistantMessageId,
		retryMessageId,
		agent: opts.agent,
		provider: opts.provider,
		model: opts.model,
		attempt: streamIdleRetryCount + 1,
		maxRetries: getProviderStreamIdleRetryMax(),
		error: toErrorMessage(err),
	});
	return true;
}

/** Whether a max-output-tokens finish should be continued in a new run. */
export function shouldContinueAfterMaxOutputTokens(args: {
	opts: RunOpts;
	finishReason: string | undefined;
	rawFinishReason: string | undefined;
}): boolean {
	const { opts } = args;
	if (!isMaxOutputTokensFinish(args.finishReason, args.rawFinishReason))
		return false;
	if (isRunCancelled(opts)) return false;
	if (opts.isCompactCommand) return false;
	return (opts.continuationCount ?? 0) < getMaxOutputContinuationRetryMax();
}

/**
 * Schedules a continuation after a max-output-tokens finish. The caller owns
 * completing the original message.
 */
export async function retryAfterMaxOutputTokensFinish(args: {
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	finishReason: string | undefined;
	rawFinishReason: string | undefined;
	runSessionLoop: RunSessionLoop;
}): Promise<boolean> {
	const { opts, db, finishReason, rawFinishReason, runSessionLoop } = args;
	if (!shouldContinueAfterMaxOutputTokens(args)) return false;

	const continuationCount = opts.continuationCount ?? 0;
	const retryMessageId = await scheduleContinuation({
		db,
		opts,
		kind: 'max-output',
		counters: { continuationCount: continuationCount + 1 },
		runSessionLoop,
		front: true,
		createdPayload: { maxOutputContinuation: true },
	});
	if (!retryMessageId) return false;
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
		maxRetries: getMaxOutputContinuationRetryMax(),
	});
	return true;
}
