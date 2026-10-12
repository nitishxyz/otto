import { getDb } from '@ottocode/database';
import { messages } from '@ottocode/database/schema';
import { loadConfig, logger } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import { publishAssistantMessageError } from '../../errors/assistant-message-error.ts';
import { toErrorLogPayload, toErrorPayload } from '../../errors/handling.ts';
import {
	isSendNowPreemptReason,
	isSystemAbortReason,
	type RunOpts,
} from '../../session/queue.ts';
import { claimPendingMessage } from '../turn/continuation.ts';

/**
 * Finalizes a run that failed before the turn executor took ownership (for
 * example during setup). Cancellation is reported as abort/preemption, not as
 * a failure.
 */
export async function markUnhandledAssistantRunFailure(
	opts: RunOpts,
	err: unknown,
) {
	try {
		const cfg = await loadConfig(opts.projectRoot);
		const db = await getDb(cfg.projectRoot);
		const existing = await db
			.select({ status: messages.status })
			.from(messages)
			.where(eq(messages.id, opts.assistantMessageId))
			.limit(1);

		if (existing[0]?.status && existing[0].status !== 'pending') {
			return;
		}

		const abortReason = opts.abortSignal?.aborted
			? opts.abortSignal.reason
			: undefined;
		if (opts.abortSignal?.aborted && isSendNowPreemptReason(abortReason)) {
			const claimed = await claimPendingMessage(db, opts.assistantMessageId, {
				status: 'complete',
				completedAt: Date.now(),
				finishReason: 'preempted',
				isAborted: false,
			});
			if (claimed) {
				publish({
					type: 'message.completed',
					sessionId: opts.sessionId,
					projectId: opts.projectId,
					projectRoot: opts.projectRoot,
					payload: {
						id: opts.assistantMessageId,
						finishReason: 'preempted',
						preemptedBy: abortReason.nextMessageId,
					},
				});
			}
			return;
		}

		if (opts.abortSignal?.aborted) {
			const system = isSystemAbortReason(abortReason);
			await publishAssistantMessageError({
				db,
				opts,
				error: {
					message: system
						? 'Cancelled before the assistant started'
						: 'Generation stopped by user',
					type: system ? 'cancelled' : 'abort',
					isAborted: !system,
				},
			});
			return;
		}

		const payload = toErrorPayload(err);
		await publishAssistantMessageError({
			db,
			opts,
			error: {
				message: payload.message || 'Assistant run failed before streaming',
				type: payload.type,
				details: payload.details,
				isAborted: false,
			},
		});
	} catch (failure) {
		logger.warn('[agent] failed to mark assistant run failure', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			error: toErrorLogPayload(failure),
			originalError: toErrorLogPayload(err),
		});
	}
}
