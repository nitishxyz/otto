import { and, eq } from 'drizzle-orm';
import { logger } from '@ottocode/sdk';
import { subagents } from '@ottocode/database/schema';
import { getSessionById } from '../session/manager.ts';
import { dispatchSubagentMessage } from './dispatch.ts';
import { buildFollowUpPrompt } from './prompt.ts';
import type { MessageSubagentInput, MessageSubagentResult } from './types.ts';

/**
 * Sends a follow-up message to an existing sub-agent's child session,
 * resuming it with full prior context. The record goes back to 'running'
 * and the parent is woken again when the follow-up finishes.
 */
export async function messageSubagent(
	input: MessageSubagentInput,
): Promise<MessageSubagentResult> {
	const { db, cfg, parentSessionId, subagentId, message } = input;

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
		return {
			ok: false,
			error:
				'Sub-agent is still running. Wait for its result before following up.',
		};
	}
	if (record.status === 'cancelled') {
		return {
			ok: false,
			error:
				'Sub-agent was cancelled; its session may be incomplete. Use delegate_task to start a fresh one.',
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

	await dispatchSubagentMessage({
		cfg,
		db,
		session: childSession,
		agent: childSession.agent,
		content: buildFollowUpPrompt(message),
	});

	logger.info('[subagent] follow-up sent', {
		subagentId: record.id,
		parentSessionId,
		childSessionId: record.childSessionId,
	});

	return {
		ok: true,
		subagentId: record.id,
		childSessionId: record.childSessionId,
		agent: record.agent,
	};
}
