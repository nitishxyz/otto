import { and, desc, eq } from 'drizzle-orm';
import { messages } from '@ottocode/database/schema';
import { retryAssistantMessage } from '../../routes/sessions/service.ts';
import {
	attemptOf,
	revertSubagentAttempt,
	startSubagentAttempt,
	subagentAttemptTurnClaim,
} from './transitions.ts';
import type { RetrySubagentInput, RetrySubagentResult } from './types.ts';

/**
 * Retries the latest assistant message in a failed sub-agent session. The
 * record enters a new running attempt (capacity reserved) before the retry is
 * dispatched, so a fast retry can never finish before the record is running;
 * a failed dispatch restores the previous state.
 */
export async function retrySubagent(
	input: RetrySubagentInput,
): Promise<RetrySubagentResult> {
	const { db, cfg, parentSessionId, subagentId } = input;

	const started = startSubagentAttempt(db, {
		subagentId,
		parentSessionId,
		allowedFrom: ['completed', 'failed'],
		disallowedMessage: (status) =>
			status === 'running'
				? 'Sub-agent is still running.'
				: 'Sub-agent was cancelled. Use subagent action=delegate to start a fresh one.',
	});
	if (!started.ok) return { ok: false, error: started.error };
	const { record, previous } = started;
	const attempt = attemptOf(record);

	const [assistantMessage] = await db
		.select()
		.from(messages)
		.where(
			and(
				eq(messages.sessionId, record.childSessionId),
				eq(messages.role, 'assistant'),
			),
		)
		.orderBy(desc(messages.createdAt))
		.limit(1);
	if (!assistantMessage) {
		revertSubagentAttempt(db, attempt, previous);
		return { ok: false, error: 'Sub-agent has no assistant message to retry.' };
	}

	let retry: Awaited<ReturnType<typeof retryAssistantMessage>>;
	try {
		db.transaction((tx) =>
			subagentAttemptTurnClaim(attempt)(tx, {
				userMessageId: '',
				assistantMessageId: assistantMessage.id,
			}),
		);
		attempt.attemptId = assistantMessage.id;
		retry = await retryAssistantMessage(
			cfg,
			db,
			record.childSessionId,
			assistantMessage.id,
		);
	} catch (error) {
		revertSubagentAttempt(db, attempt, previous);
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	if (!retry.ok) {
		revertSubagentAttempt(db, attempt, previous);
		return { ok: false, error: retry.body.error };
	}

	return {
		ok: true,
		subagentId: record.id,
		childSessionId: record.childSessionId,
		agent: record.agent,
		messageId: retry.body.messageId,
	};
}
