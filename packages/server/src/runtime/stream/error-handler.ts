import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { APICallError } from 'ai';
import { publish, publishClientEvent } from '../../events/bus.ts';
import { toErrorPayload } from '../errors/handling.ts';
import { isSendNowPreemptReason, type RunOpts } from '../session/queue.ts';
import type { ToolAdapterContext } from '../../tools/adapter.ts';
import { pruneSession, performAutoCompaction } from '../message/compaction.ts';
import { enqueueAssistantRun } from '../session/queue.ts';
import { clearPendingTopup } from '../topup/manager.ts';

export function createErrorHandler(
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
	getStepIndex: () => number,
	sharedCtx: ToolAdapterContext,
	retryCallback?: (sessionId: string) => Promise<void>,
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

		const errorType =
			(errObj?.apiErrorType as string) ?? (nestedError?.type as string) ?? '';
		const fullErrorStrLower = JSON.stringify(err).toLowerCase();

		const isPromptTooLong =
			fullErrorStrLower.includes('prompt is too long') ||
			fullErrorStrLower.includes('maximum context length') ||
			fullErrorStrLower.includes('too many tokens') ||
			fullErrorStrLower.includes('context_length_exceeded') ||
			fullErrorStrLower.includes('request too large') ||
			fullErrorStrLower.includes('exceeds the model') ||
			fullErrorStrLower.includes('exceeds the limit') ||
			fullErrorStrLower.includes('prompt token count') ||
			fullErrorStrLower.includes('context window') ||
			fullErrorStrLower.includes('input is too long') ||
			errorCode === 'context_length_exceeded' ||
			errorType === 'invalid_request_error';

		if (isPromptTooLong && !opts.isCompactCommand) {
			const retries = opts.compactionRetries ?? 0;
			if (retries >= 2) {
			} else {
				await db
					.update(messages)
					.set({ status: 'complete', completedAt: Date.now() })
					.where(eq(messages.id, opts.assistantMessageId));

				publish({
					type: 'message.completed',
					sessionId: opts.sessionId,
					payload: {
						id: opts.assistantMessageId,
						autoCompacted: true,
					},
				});

				const compactMessageId = crypto.randomUUID();
				const compactMessageTime = Date.now();
				await db.insert(messages).values({
					id: compactMessageId,
					sessionId: opts.sessionId,
					role: 'assistant',
					status: 'pending',
					agent: opts.agent,
					provider: opts.provider,
					model: opts.model,
					createdAt: compactMessageTime,
				});

				publish({
					type: 'message.created',
					sessionId: opts.sessionId,
					payload: {
						id: compactMessageId,
						role: 'assistant',
						agent: opts.agent,
						provider: opts.provider,
						model: opts.model,
					},
				});

				let compactionSucceeded = false;
				try {
					const publishWrapper = (event: {
						type: string;
						sessionId: string;
						payload: Record<string, unknown>;
					}) => {
						publish(event as Parameters<typeof publish>[0]);
					};
					const compactResult = await performAutoCompaction(
						db,
						opts.sessionId,
						compactMessageId,
						publishWrapper,
						opts.provider,
						opts.model,
						opts.assistantMessageId,
					);
					if (compactResult.success) {
						compactionSucceeded = true;
					} else {
						const pruneResult = await pruneSession(db, opts.sessionId);
						compactionSucceeded = pruneResult.pruned > 0;
					}
				} catch {}

				await db
					.update(messages)
					.set({
						status: compactionSucceeded ? 'complete' : 'error',
						completedAt: Date.now(),
					})
					.where(eq(messages.id, compactMessageId));

				publish({
					type: 'message.completed',
					sessionId: opts.sessionId,
					payload: { id: compactMessageId, autoCompacted: true },
				});

				if (compactionSucceeded && retryCallback) {
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
						},
					});

					enqueueAssistantRun(
						{
							...opts,
							assistantMessageId: retryMessageId,
							compactionRetries: retries + 1,
						},
						retryCallback,
						{ front: true },
					);
					return;
				}

				if (compactionSucceeded) {
					return;
				}
			}
		}

		const errorPartId = crypto.randomUUID();
		const displayMessage =
			isPromptTooLong && !opts.isCompactCommand
				? `${errorPayload.message}. Context auto-compacted - please retry your message.`
				: errorPayload.message;
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
					autoCompacted: isPromptTooLong && !opts.isCompactCommand,
				}),
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
				autoCompacted: isPromptTooLong && !opts.isCompactCommand,
			},
		});

		const createdAt = new Date().toISOString();
		publishClientEvent({
			type: 'session.status',
			payload: {
				sessionId: opts.sessionId,
				status: 'failed',
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
				createdAt,
			},
		});
	};
}
