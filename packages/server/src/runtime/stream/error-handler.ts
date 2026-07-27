import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { APICallError } from 'ai';
import { publish, publishClientEvent } from '../../events/bus.ts';
import { isContextOverflowError } from '../errors/context-overflow.ts';
import { toErrorPayload } from '../errors/handling.ts';
import { isSendNowPreemptReason, type RunOpts } from '../session/queue.ts';
import type { ToolAdapterContext } from '../../tools/adapter.ts';
import { recoverContextOverflow } from '../agent/runner/runner-context-overflow.ts';
import { hasRunningSubagentDescendant } from '../session/working.ts';
import { clearPendingTopup } from '../topup/manager.ts';

export function createErrorHandler(
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
	getStepIndex: () => number,
	sharedCtx: ToolAdapterContext,
	retryCallback: (sessionId: string) => Promise<void>,
) {
	return async (err: unknown) => {
		if (
			isSendNowPreemptReason(
				(opts.abortSignal as (AbortSignal & { reason?: unknown }) | undefined)
					?.reason,
			)
		) {
			return;
		}

		const errorPayload = toErrorPayload(err);
		const isApiError = APICallError.isInstance(err);
		const stepIndex = getStepIndex();

		const errObj = err as Record<string, unknown>;
		const nestedError = (errObj?.error as Record<string, unknown>)?.error as
			| Record<string, unknown>
			| undefined;
		const causeError = errObj?.cause as Record<string, unknown> | undefined;

		// Check for OTTOROUTER_FIAT_SELECTED code specifically (not string matching)
		const errorCode =
			(errObj?.code as string) ??
			((errObj?.error as Record<string, unknown>)?.code as string) ??
			((
				(errObj?.error as Record<string, unknown>)?.error as Record<
					string,
					unknown
				>
			)?.code as string) ??
			((errObj?.data as Record<string, unknown>)?.code as string) ??
			((errObj?.cause as Record<string, unknown>)?.code as string) ??
			((
				(errObj?.cause as Record<string, unknown>)?.error as Record<
					string,
					unknown
				>
			)?.code as string) ??
			(nestedError?.code as string) ??
			(causeError?.code as string) ??
			'';

		// Also check error message for the exact fiat selection message
		const _errorMessage =
			(errObj?.message as string) ??
			((errObj?.error as Record<string, unknown>)?.message as string) ??
			((
				(errObj?.error as Record<string, unknown>)?.error as Record<
					string,
					unknown
				>
			)?.message as string) ??
			((errObj?.data as Record<string, unknown>)?.message as string) ??
			((errObj?.cause as Record<string, unknown>)?.message as string) ??
			((
				(errObj?.cause as Record<string, unknown>)?.error as Record<
					string,
					unknown
				>
			)?.message as string) ??
			(nestedError?.message as string) ??
			(causeError?.message as string) ??
			'';

		const isFiatSelected = errorCode === 'OTTOROUTER_FIAT_SELECTED';

		// Handle fiat payment selected - this is not an error, just a signal to pause
		if (isFiatSelected) {
			clearPendingTopup(opts.sessionId);

			// Add a helpful message part telling user to complete payment
			const partId = crypto.randomUUID();
			await db.insert(messageParts).values({
				id: partId,
				messageId: opts.assistantMessageId,
				index: await sharedCtx.nextIndex(),
				stepIndex: getStepIndex(),
				type: 'error',
				content: JSON.stringify({
					message: 'Balance too low — Complete your top-up, then retry.',
					type: 'balance_low',
					errorType: 'balance_low',
					isRetryable: true,
				}),
				agent: opts.agent,
				provider: opts.provider,
				model: opts.model,
				startedAt: Date.now(),
				completedAt: Date.now(),
			});

			// Mark the message as completed (not error, not pending)
			await db
				.update(messages)
				.set({
					status: 'complete',
					completedAt: Date.now(),
					error: null,
					errorType: null,
					errorDetails: null,
				})
				.where(eq(messages.id, opts.assistantMessageId));

			// Emit the message part
			publish({
				type: 'message.part.delta',
				sessionId: opts.sessionId,
				payload: {
					messageId: opts.assistantMessageId,
					partId,
					type: 'error',
					content: JSON.stringify({
						message: 'Balance too low — Complete your top-up, then retry.',
						type: 'balance_low',
						errorType: 'balance_low',
						isRetryable: true,
					}),
				},
			});

			// Emit message completed
			publish({
				type: 'message.completed',
				sessionId: opts.sessionId,
				payload: {
					id: opts.assistantMessageId,
					fiatTopupRequired: true,
				},
			});

			// Emit a special event so UI knows to show topup modal
			publish({
				type: 'ottorouter.fiat.checkout_created',
				sessionId: opts.sessionId,
				payload: {
					messageId: opts.assistantMessageId,
					needsTopup: true,
				},
			});

			return;
		}

		const isPromptTooLong = isContextOverflowError(err);

		if (isPromptTooLong && !opts.isCompactCommand) {
			const recovery = await recoverContextOverflow({
				db,
				opts,
				runSessionLoop: retryCallback,
			});
			if (recovery !== 'failed') return;
		}

		const errorPartId = crypto.randomUUID();
		const displayMessage = errorPayload.message;
		const errorPartType = isPromptTooLong
			? 'context_length_exceeded'
			: errorPayload.type;
		await db.insert(messageParts).values({
			id: errorPartId,
			messageId: opts.assistantMessageId,
			index: await sharedCtx.nextIndex(),
			stepIndex,
			type: 'error',
			content: JSON.stringify({
				message: displayMessage,
				type: errorPartType,
				errorType: isPromptTooLong ? 'context_length_exceeded' : undefined,
				details: errorPayload.details,
				isAborted: false,
			}),
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			startedAt: Date.now(),
			completedAt: Date.now(),
		});

		await db
			.update(messages)
			.set({
				status: 'error',
				error: displayMessage,
				errorType: errorPartType,
				errorDetails: JSON.stringify({
					...errorPayload.details,
					isApiError,
					autoCompacted: false,
				}),
				finishReason: 'error',
				isAborted: false,
			})
			.where(eq(messages.id, opts.assistantMessageId));

		publish({
			type: 'error',
			sessionId: opts.sessionId,
			payload: {
				messageId: opts.assistantMessageId,
				partId: errorPartId,
				error: displayMessage,
				errorType: errorPartType,
				details: errorPayload.details,
				isAborted: false,
				autoCompacted: false,
			},
		});

		const createdAt = new Date().toISOString();
		const status = (await hasRunningSubagentDescendant(db, opts.sessionId))
			? 'running'
			: 'failed';
		publishClientEvent({
			type: 'session.status',
			payload: {
				sessionId: opts.sessionId,
				projectId: opts.projectId,
				projectRoot: opts.projectRoot,
				status,
				messageId: opts.assistantMessageId,
				createdAt,
			},
		});
		publishClientEvent({
			type: 'notification',
			payload: {
				id: crypto.randomUUID(),
				level: 'error',
				title: 'Session failed',
				body: displayMessage,
				source: 'session',
				sessionId: opts.sessionId,
				projectId: opts.projectId,
				projectRoot: opts.projectRoot,
				createdAt,
			},
		});
	};
}
