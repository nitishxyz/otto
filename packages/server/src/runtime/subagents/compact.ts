import type { DB } from '@ottocode/database';
import { subagents } from '@ottocode/database/schema';
import type { OttoConfig } from '@ottocode/sdk';
import { and, eq } from 'drizzle-orm';
import { getSessionById } from '../session/manager.ts';
import { sendQueuedMessageNow } from '../session/queue.ts';
import { dispatchSubagentMessage } from './dispatch.ts';

export type CompactSubagentResult =
	| {
			ok: true;
			subagentId: string;
			childSessionId: string;
			agent: string;
			messageId: string;
			status: 'queued';
			delivery: 'queue' | 'interrupt';
			preemptedMessageId: string | null;
	  }
	| { ok: false; error: string };

/** Delivers the built-in /compact command to an owned sub-agent session. */
export async function compactSubagent(args: {
	db: DB;
	cfg: OttoConfig;
	parentSessionId: string;
	subagentId: string;
	delivery?: 'queue' | 'interrupt';
}): Promise<CompactSubagentResult> {
	const delivery = args.delivery ?? 'queue';
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

	const childSession = await getSessionById({
		db: args.db,
		sessionId: record.childSessionId,
	});
	if (!childSession) {
		return { ok: false, error: 'Sub-agent session no longer exists.' };
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
	let preemptedMessageId: string | null = null;
	if (delivery === 'interrupt') {
		const { runSessionLoop } = await import('../agent/runner.ts');
		const sendNowResult = sendQueuedMessageNow(
			record.childSessionId,
			assistantMessageId,
			runSessionLoop,
		);
		if (sendNowResult.success) {
			preemptedMessageId = sendNowResult.preemptedMessageId;
		}
	}
	return {
		ok: true,
		subagentId: record.id,
		childSessionId: record.childSessionId,
		agent: record.agent,
		messageId: assistantMessageId,
		status: 'queued',
		delivery,
		preemptedMessageId,
	};
}
