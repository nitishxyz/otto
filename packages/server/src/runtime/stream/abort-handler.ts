import type { getDb } from '@ottocode/database';
import { publish } from '../../events/bus.ts';
import {
	isSendNowPreemptReason,
	isSystemAbortReason,
	type RunOpts,
} from '../session/queue.ts';
import type { ToolAdapterContext } from '../../tools/adapter.ts';
import { claimPendingMessage } from '../agent/turn/continuation.ts';
import { publishAssistantMessageError } from '../errors/assistant-message-error.ts';
import type { AbortEvent } from './types.ts';

export function createAbortHandler(
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
	getStepIndex: () => number,
	sharedCtx: ToolAdapterContext,
) {
	return async ({ steps }: AbortEvent) => {
		const reason = opts.abortSignal?.reason;
		const now = Date.now();
		if (isSendNowPreemptReason(reason)) {
			const claimed = await claimPendingMessage(db, opts.assistantMessageId, {
				status: 'complete',
				completedAt: now,
				error: null,
				errorType: null,
				errorDetails: JSON.stringify({
					preemptedBy: reason.nextMessageId,
					stepsCompleted: steps.length,
					preemptedAt: now,
				}),
				finishReason: 'preempted',
				isAborted: false,
			});
			if (!claimed) return;
			publish({
				type: 'message.completed',
				sessionId: opts.sessionId,
				projectId: opts.projectId,
				projectRoot: opts.projectRoot,
				payload: {
					id: opts.assistantMessageId,
					finishReason: 'preempted',
					preemptedBy: reason.nextMessageId,
				},
			});
			return;
		}
		const system = isSystemAbortReason(reason);
		await publishAssistantMessageError({
			db,
			opts,
			stepIndex: getStepIndex(),
			nextPartIndex: () => sharedCtx.nextIndex(),
			error: {
				message: system
					? reason.type === 'subagent-stopped-by-parent'
						? 'Stopped by the parent agent'
						: 'Cancelled because the parent session was aborted'
					: 'Generation stopped by user',
				type: system ? 'cancelled' : 'abort',
				finishReason: system ? 'cancelled' : 'abort',
				isAborted: !system,
				details: { stepsCompleted: steps.length, abortedAt: now },
			},
		});
	};
}
