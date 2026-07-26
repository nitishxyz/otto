import type { DB } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import type { OttoConfig } from '@ottocode/sdk';
import { and, eq } from 'drizzle-orm';
import { getSessionById } from '../session/manager.ts';
import { getQueueState } from '../session/queue.ts';
import { dispatchSubagentMessage } from './dispatch.ts';

export type CompactSubagentResult =
	| {
			ok: true;
			subagentId: string;
			childSessionId: string;
			agent: string;
			messageId: string;
			status: 'queued';
	  }
	| { ok: false; error: string };

/** Queues the built-in /compact command in an owned sub-agent session. */
export async function compactSubagent(args: {
	db: DB;
	cfg: OttoConfig;
	parentSessionId: string;
	subagentId: string;
}): Promise<CompactSubagentResult> {
	const rows = await args.db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.id, args.subagentId),
				eq(subagents.parentSessionId, args.parentSessionId),
			),
		)
		.limit(1);
	const record = rows[0];
	if (!record) {
		return {
			ok: false,
			error: `No sub-agent with id "${args.subagentId}" for this session. Use subagent action=list to find ids.`,
		};
	}
	if (record.status === 'running') {
		return {
			ok: false,
			error:
				'Sub-agent is still running. Wait for its delegated work to finish before compacting its session.',
		};
	}
	if (record.status === 'cancelled') {
		return {
			ok: false,
			error:
				'Sub-agent was cancelled; its session may be incomplete and cannot be compacted.',
		};
	}

	const childSession = await getSessionById({
		db: args.db,
		sessionId: record.childSessionId,
	});
	if (!childSession) {
		return { ok: false, error: 'Sub-agent session no longer exists.' };
	}
	const queue = getQueueState(record.childSessionId);
	if (queue?.isRunning || queue?.queuedMessages.length) {
		return {
			ok: false,
			error: 'Sub-agent session already has active or queued work.',
		};
	}

	// Keep the lifecycle record unchanged: compaction is session maintenance,
	// not a new delegated result that should be reported back to the parent.
	const { assistantMessageId } = await dispatchSubagentMessage({
		cfg: args.cfg,
		db: args.db,
		session: childSession,
		agent: childSession.agent,
		content: '/compact',
	});
	return {
		ok: true,
		subagentId: record.id,
		childSessionId: record.childSessionId,
		agent: record.agent,
		messageId: assistantMessageId,
		status: 'queued',
	};
}
