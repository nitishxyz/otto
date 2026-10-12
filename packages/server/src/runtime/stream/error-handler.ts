import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { and, eq } from 'drizzle-orm';
import { APICallError } from 'ai';
import { publish } from '../../events/bus.ts';
import { isContextOverflowError } from '../errors/context-overflow.ts';
import { toErrorPayload } from '../errors/handling.ts';
import { publishAssistantMessageError } from '../errors/assistant-message-error.ts';
import type { RunOpts } from '../session/queue.ts';
import type { ToolAdapterContext } from '../../tools/adapter.ts';
import { recoverContextOverflow } from '../agent/runner/runner-context-overflow.ts';
import { clearPendingTopup } from '../topup/manager.ts';
import type { RunSessionLoop } from '../agent/turn/types.ts';
import { findToolResultDurabilityError } from '../agent/turn/durability.ts';

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== 'object') return undefined;
	const record = error as Record<string, unknown>;
	if (typeof record.code === 'string') return record.code;
	for (const nested of [record.error, record.cause, record.data]) {
		if (!nested || typeof nested !== 'object') continue;
		const object = nested as Record<string, unknown>;
		if (typeof object.code === 'string') return object.code;
		if (object.error && typeof object.error === 'object') {
			const code = (object.error as Record<string, unknown>).code;
			if (typeof code === 'string') return code;
		}
	}
	return undefined;
}

export function createErrorHandler(
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
	getStepIndex: () => number,
	sharedCtx: ToolAdapterContext,
	retryCallback: RunSessionLoop,
) {
	return async (err: unknown) => {
		const stepIndex = getStepIndex();
		if (errorCode(err) === 'OTTOROUTER_FIAT_SELECTED') {
			const partId = crypto.randomUUID();
			const index = await sharedCtx.nextIndex();
			const content = JSON.stringify({
				message: 'Balance too low — Complete your top-up, then retry.',
				type: 'balance_low',
				errorType: 'balance_low',
				isRetryable: true,
			});
			const now = Date.now();
			const claimed = db.transaction((tx) => {
				const updated = tx
					.update(messages)
					.set({
						status: 'complete',
						completedAt: now,
						error: null,
						errorType: null,
						errorDetails: null,
					})
					.where(
						and(
							eq(messages.id, opts.assistantMessageId),
							eq(messages.status, 'pending'),
						),
					)
					.returning({ id: messages.id })
					.all();
				if (!updated.length) return false;
				tx.insert(messageParts)
					.values({
						id: partId,
						messageId: opts.assistantMessageId,
						index,
						stepIndex,
						type: 'error',
						content,
						agent: opts.agent,
						provider: opts.provider,
						model: opts.model,
						startedAt: now,
						completedAt: now,
					})
					.run();
				return true;
			});
			if (!claimed) return;
			clearPendingTopup(opts.sessionId);
			publish({
				type: 'message.part.delta',
				sessionId: opts.sessionId,
				projectId: opts.projectId,
				projectRoot: opts.projectRoot,
				payload: {
					messageId: opts.assistantMessageId,
					partId,
					type: 'error',
					content,
				},
			});
			publish({
				type: 'message.completed',
				sessionId: opts.sessionId,
				projectId: opts.projectId,
				projectRoot: opts.projectRoot,
				payload: { id: opts.assistantMessageId, fiatTopupRequired: true },
			});
			publish({
				type: 'ottorouter.fiat.checkout_created',
				sessionId: opts.sessionId,
				projectId: opts.projectId,
				projectRoot: opts.projectRoot,
				payload: { messageId: opts.assistantMessageId, needsTopup: true },
			});
			return;
		}

		const isPromptTooLong =
			findToolResultDurabilityError(err) === undefined &&
			isContextOverflowError(err);
		if (isPromptTooLong && !opts.isCompactCommand) {
			const recovery = await recoverContextOverflow({
				db,
				opts,
				runSessionLoop: retryCallback,
			});
			if (recovery !== 'failed') return;
		}
		const payload = toErrorPayload(err);
		await publishAssistantMessageError({
			db,
			opts,
			stepIndex,
			nextPartIndex: () => sharedCtx.nextIndex(),
			error: {
				message: payload.message,
				type: isPromptTooLong ? 'context_length_exceeded' : payload.type,
				details: {
					...payload.details,
					isApiError: APICallError.isInstance(err),
					autoCompacted: false,
				},
				isAborted: false,
			},
			publishNotification: true,
		});
	};
}
