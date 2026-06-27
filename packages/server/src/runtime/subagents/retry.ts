import { and, desc, eq } from 'drizzle-orm';
import { messages, subagents } from '@ottocode/database/schema';
import { retryAssistantMessage } from '../../routes/sessions/service.ts';
import type { RetrySubagentInput, RetrySubagentResult } from './types.ts';

/** Retries the latest assistant message in a failed sub-agent session. */
export async function retrySubagent(
	input: RetrySubagentInput,
): Promise<RetrySubagentResult> {
	const { db, cfg, parentSessionId, subagentId } = input;

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
			error: `No sub-agent with id "${subagentId}" for this session. Use list_subagents to find ids.`,
		};
	}
	if (record.status === 'running') {
		return { ok: false, error: 'Sub-agent is still running.' };
	}
	if (record.status === 'cancelled') {
		return {
			ok: false,
			error: 'Sub-agent was cancelled. Use delegate_task to start a fresh one.',
		};
	}

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
		return { ok: false, error: 'Sub-agent has no assistant message to retry.' };
	}

	const retry = await retryAssistantMessage(
		cfg,
		db,
		record.childSessionId,
		assistantMessage.id,
	);
	if (!retry.ok) return { ok: false, error: retry.body.error };

	const now = Date.now();
	await db
		.update(subagents)
		.set({ status: 'running', reported: false, updatedAt: now })
		.where(eq(subagents.id, record.id));

	return {
		ok: true,
		subagentId: record.id,
		childSessionId: record.childSessionId,
		agent: record.agent,
		messageId: retry.body.messageId,
	};
}
