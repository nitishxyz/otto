import type { getDb } from '@ottocode/database';
import { sessions } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import { publishAssistantMessageError } from '../../errors/assistant-message-error.ts';
import { toErrorPayload } from '../../errors/handling.ts';
import {
	pruneSession,
	shouldAutoCompactBeforeOverflow,
} from '../../message/compaction.ts';
import type {
	completeAssistantMessage,
	updateMessageTokensIncremental,
	updateSessionTokensIncremental,
} from '../../session/db-operations.ts';
import type { RunOpts } from '../../session/queue.ts';

type CompleteAssistantMessage = typeof completeAssistantMessage;
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

function isPromptTooLongError(err: unknown): boolean {
	const errorMessage = err instanceof Error ? err.message : String(err);
	const errorCode = (err as { code?: string })?.code ?? '';
	const responseBody = (err as { responseBody?: string })?.responseBody ?? '';
	const apiErrorType = (err as { apiErrorType?: string })?.apiErrorType ?? '';
	const combinedError = `${errorMessage} ${responseBody}`.toLowerCase();

	return (
		combinedError.includes('prompt is too long') ||
		combinedError.includes('maximum context length') ||
		combinedError.includes('too many tokens') ||
		combinedError.includes('context_length_exceeded') ||
		combinedError.includes('request too large') ||
		combinedError.includes('exceeds the model') ||
		combinedError.includes('input is too long') ||
		errorCode === 'context_length_exceeded' ||
		apiErrorType === 'invalid_request_error'
	);
}

export async function handleRunnerError(args: {
	err: unknown;
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	completeAssistantMessage: CompleteAssistantMessage;
	updateSessionTokensIncremental: UpdateSessionTokensIncremental;
	updateMessageTokensIncremental: UpdateMessageTokensIncremental;
	nextPartIndex?: () => number | Promise<number>;
}): Promise<'handled' | 'rethrow'> {
	const { err, opts, db } = args;
	const payload = toErrorPayload(err);

	if (isPromptTooLongError(err) && !opts.isCompactCommand) {
		try {
			const pruneResult = await pruneSession(db, opts.sessionId);
			void pruneResult;

			publish({
				type: 'error',
				sessionId: opts.sessionId,
				payload: {
					...payload,
					message: `Context too large. Auto-compacted old tool results. Please retry your message.`,
					name: 'ContextOverflow',
				},
			});

			try {
				await args.completeAssistantMessage({}, opts, db);
			} catch {}
			return 'handled';
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
