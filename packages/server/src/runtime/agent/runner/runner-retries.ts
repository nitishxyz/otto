import { logger } from '@ottocode/sdk';
import type { getDb } from '@ottocode/database';
import { messages } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import type { RunOpts } from '../../session/queue.ts';
import { enqueueAssistantRun } from '../../session/queue.ts';
import { cleanupEmptyTextParts } from '../../session/db-operations.ts';

const OPENAI_OAUTH_CODEX_STREAM_IDLE_RETRY_MAX = 2;
const MAX_OUTPUT_CONTINUATION_RETRY_MAX = 2;

type RunSessionLoop = (sessionId: string) => Promise<void>;

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

export async function retryOpenAIOAuthCodexAfterStreamIdleTimeout(args: {
	err: unknown;
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	isOpenAIOAuth: boolean;
	runSessionLoop: RunSessionLoop;
}): Promise<boolean> {
	const { err, opts, db, isOpenAIOAuth, runSessionLoop } = args;
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

export async function retryAfterMaxOutputTokensFinish(args: {
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	finishReason: string | undefined;
	rawFinishReason: string | undefined;
	runSessionLoop: RunSessionLoop;
}): Promise<boolean> {
	const { opts, db, finishReason, rawFinishReason, runSessionLoop } = args;
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
