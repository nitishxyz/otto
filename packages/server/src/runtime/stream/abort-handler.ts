import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish } from '../../events/bus.ts';
import {
	isSendNowPreemptReason,
	isSystemAbortReason,
	type RunOpts,
} from '../session/queue.ts';
import type { ToolAdapterContext } from '../../tools/adapter.ts';
import type { AbortEvent } from './types.ts';

function getAbortClassification(reason: unknown): {
	message: string;
	type: string;
	finishReason: string;
	isAborted: boolean;
} {
	if (isSystemAbortReason(reason)) {
		const stoppedByParent = reason.type === 'subagent-stopped-by-parent';
		return {
			message: stoppedByParent
				? 'Stopped by the parent agent'
				: 'Cancelled because the parent session was aborted',
			type: 'cancelled',
			finishReason: 'cancelled',
			isAborted: false,
		};
	}

	return {
		message: 'Generation stopped by user',
		type: 'abort',
		finishReason: 'abort',
		isAborted: true,
	};
}

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
					finishReason: 'preempted',
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

		const classification = getAbortClassification(abortReason);

		const abortPartId = crypto.randomUUID();
		await db.insert(messageParts).values({
			id: abortPartId,
			messageId: opts.assistantMessageId,
			index: await sharedCtx.nextIndex(),
			stepIndex,
			type: 'error',
			content: JSON.stringify({
				message: classification.message,
				type: classification.type,
				isAborted: classification.isAborted,
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
				error: classification.message,
				errorType: classification.type,
				errorDetails: JSON.stringify({
					stepsCompleted: steps.length,
					abortedAt: Date.now(),
				}),
				finishReason: classification.finishReason,
				isAborted: classification.isAborted,
			})
			.where(eq(messages.id, opts.assistantMessageId));

		publish({
			type: 'error',
			sessionId: opts.sessionId,
			payload: {
				messageId: opts.assistantMessageId,
				partId: abortPartId,
				error: classification.message,
				errorType: classification.type,
				isAborted: classification.isAborted,
				stepsCompleted: steps.length,
			},
		});
	};
}
