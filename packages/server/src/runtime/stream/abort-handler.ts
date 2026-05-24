import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../events/bus.ts';
import { isSendNowPreemptReason, type RunOpts } from '../session/queue.ts';
import type { ToolAdapterContext } from '../../tools/adapter.ts';
import type { AbortEvent } from './types.ts';

export function createAbortHandler(
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
	getStepIndex: () => number,
	sharedCtx: ToolAdapterContext,
) {
	return async ({ steps }: AbortEvent) => {
		const stepIndex = getStepIndex();
		const abortReason = (
			opts.abortSignal as (AbortSignal & { reason?: unknown }) | undefined
		)?.reason;

		if (isSendNowPreemptReason(abortReason)) {
			await db
				.update(messages)
				.set({
					status: 'complete',
					completedAt: Date.now(),
					error: null,
					errorType: null,
					errorDetails: JSON.stringify({
						preemptedBy: abortReason.nextMessageId,
						stepsCompleted: steps.length,
						preemptedAt: Date.now(),
					}),
					isAborted: false,
				})
				.where(eq(messages.id, opts.assistantMessageId));

			publish({
				type: 'message.completed',
				sessionId: opts.sessionId,
				payload: {
					id: opts.assistantMessageId,
					finishReason: 'preempted',
					preemptedBy: abortReason.nextMessageId,
				},
			});
			return;
		}

		const abortPartId = crypto.randomUUID();
		await db.insert(messageParts).values({
			id: abortPartId,
			messageId: opts.assistantMessageId,
			index: await sharedCtx.nextIndex(),
			stepIndex,
			type: 'error',
			content: JSON.stringify({
				message: 'Generation stopped by user',
				type: 'abort',
				isAborted: true,
				stepsCompleted: steps.length,
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
				error: 'Generation stopped by user',
				errorType: 'abort',
				errorDetails: JSON.stringify({
					stepsCompleted: steps.length,
					abortedAt: Date.now(),
				}),
				isAborted: true,
			})
			.where(eq(messages.id, opts.assistantMessageId));

		publish({
			type: 'error',
			sessionId: opts.sessionId,
			payload: {
				messageId: opts.assistantMessageId,
				partId: abortPartId,
				error: 'Generation stopped by user',
				errorType: 'abort',
				isAborted: true,
				stepsCompleted: steps.length,
			},
		});
	};
}
