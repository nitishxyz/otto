import { and, eq } from 'drizzle-orm';
import { logger } from '@ottocode/sdk';
import { subagents } from '@ottocode/database/schema';
import { getSessionById } from '../session/manager.ts';
import { sendQueuedMessageNow } from '../session/queue.ts';
import { dispatchSubagentMessage } from './dispatch.ts';
import { buildFollowUpPrompt } from './prompt.ts';
import type { MessageSubagentInput, MessageSubagentResult } from './types.ts';

/**
 * Sends a follow-up message to an existing sub-agent's child session,
 * resuming it with full prior context. Queue delivery waits behind an active
 * run; interrupt delivery silently preempts the active run and executes next.
 */
export async function messageSubagent(
	input: MessageSubagentInput,
): Promise<MessageSubagentResult> {
	const { db, cfg, parentSessionId, subagentId, message } = input;
	const delivery = input.delivery ?? 'queue';

	const rows = await db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.id, subagentId),
				eq(subagents.parentSessionId, parentSessionId),
			),
		)
		.limit(1);
	const record = rows[0];
	if (!record) {
		return {
			ok: false,
			error: `No sub-agent with id "${subagentId}" for this session. Use subagent action=list to find ids.`,
		};
	}
	if (record.status === 'cancelled') {
		return {
			ok: false,
			error:
				'Sub-agent was cancelled; its session may be incomplete. Use subagent action=delegate to start a fresh one.',
		};
	}

	const childSession = await getSessionById({
		db,
		sessionId: record.childSessionId,
	});
	if (!childSession) {
		return { ok: false, error: 'Sub-agent session no longer exists.' };
	}

	const now = Date.now();
	await db
		.update(subagents)
		.set({ status: 'running', reported: false, updatedAt: now })
		.where(eq(subagents.id, record.id));

	const { assistantMessageId } = await dispatchSubagentMessage({
		cfg,
		db,
		session: childSession,
		agent: childSession.agent,
		content: buildFollowUpPrompt(message),
	});
	let sendNowResult: ReturnType<typeof sendQueuedMessageNow> | undefined;
	if (delivery === 'interrupt') {
		const { runSessionLoop } = await import('../agent/runner.ts');
		sendNowResult = sendQueuedMessageNow(
			record.childSessionId,
			assistantMessageId,
			runSessionLoop,
		);
	}

	logger.info('[subagent] follow-up sent', {
		subagentId: record.id,
		parentSessionId,
		childSessionId: record.childSessionId,
		wasRunning: record.status === 'running',
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
