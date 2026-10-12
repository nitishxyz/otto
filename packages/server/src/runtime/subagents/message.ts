import { logger } from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';
import { getSessionById } from '../session/manager.ts';
import { sendQueuedMessageNow } from '../session/queue.ts';
import { dispatchSubagentMessage } from './dispatch.ts';
import { buildFollowUpPrompt } from './prompt.ts';
import {
	attemptOf,
	revertSubagentAttempt,
	startSubagentAttempt,
	subagentAttemptTurnClaim,
} from './transitions.ts';
import type { MessageSubagentInput, MessageSubagentResult } from './types.ts';

/**
 * Sends a follow-up message to an existing sub-agent's child session,
 * resuming it with full prior context. Queue delivery waits behind an active
 * run; interrupt delivery silently preempts the active run and executes next.
 * The record transitions to a new running attempt (capacity reserved) before
 * dispatch; a failed dispatch restores the previous state.
 */
export async function messageSubagent(
	input: MessageSubagentInput,
): Promise<MessageSubagentResult> {
	const { db, cfg, parentSessionId, subagentId, message } = input;
	const delivery = input.delivery ?? 'queue';

	const started = startSubagentAttempt(db, {
		subagentId,
		parentSessionId,
		allowedFrom: ['running', 'completed', 'failed', 'cancelled'],
	});
	if (!started.ok) return { ok: false, error: started.error };
	const { record, previous } = started;
	const attempt = attemptOf(record);
	const childSession = await getSessionById({
		db,
		sessionId: record.childSessionId,
	});
	if (!childSession) {
		revertSubagentAttempt(db, attempt, previous);
		return { ok: false, error: 'Sub-agent session no longer exists.' };
	}

	let assistantMessageId: string;
	try {
		({ assistantMessageId } = await dispatchSubagentMessage({
			cfg,
			db,
			session: childSession,
			agent: childSession.agent,
			content: buildFollowUpPrompt(message),
			context: input.files?.length ? { files: input.files } : undefined,
			messageOrigin: 'parent-agent',
			memoryTask: message,
			acceptClaim: subagentAttemptTurnClaim(attempt),
		}));
	} catch (error) {
		revertSubagentAttempt(db, attempt, previous);
		const reason = error instanceof Error ? error.message : String(error);
		logger.warn('[subagent] follow-up dispatch failed', {
			subagentId: record.id,
			error: reason,
		});
		return { ok: false, error: `Failed to deliver follow-up: ${reason}` };
	}
	let sendNowResult: ReturnType<typeof sendQueuedMessageNow> | undefined;
	if (delivery === 'interrupt') {
		const { runSessionLoop } = await import('../agent/runner.ts');
		sendNowResult = sendQueuedMessageNow(
			record.childSessionId,
			assistantMessageId,
			runSessionLoop,
			cfg.projectRoot,
		);
	}

	publish({
		type: 'session.updated',
		sessionId: parentSessionId,
		projectRoot: cfg.projectRoot,
		payload: {
			id: parentSessionId,
			subagentUpdated: {
				subagentId: record.id,
				childSessionId: record.childSessionId,
				agent: record.agent,
				status: 'running',
			},
		},
	});

	logger.info('[subagent] follow-up sent', {
		subagentId: record.id,
		parentSessionId,
		childSessionId: record.childSessionId,
		wasRunning: previous.status === 'running',
		resumedAfterStop: previous.status === 'cancelled',
		delivery,
		preemptedMessageId:
			sendNowResult?.success === true
				? sendNowResult.preemptedMessageId
				: undefined,
	});

	return {
		ok: true,
		subagentId: record.id,
		childSessionId: record.childSessionId,
		agent: record.agent,
		messageId: assistantMessageId,
		delivery,
		preemptedMessageId:
			sendNowResult?.success === true ? sendNowResult.preemptedMessageId : null,
	};
}
