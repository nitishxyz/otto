import { and, asc, desc, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { messageParts, messages, subagents } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import type { SubagentRecord } from './types.ts';

/**
 * Finalizes the sub-agent record for a child session whose run just finished.
 * Returns the updated record, or undefined when the session is not a running sub-agent.
 */
export async function finalizeSubagentForChildSession(
	db: DB,
	childSessionId: string,
): Promise<SubagentRecord | undefined> {
	const rows = await db
		.select()
		.from(subagents)
		.where(
			and(
				eq(subagents.childSessionId, childSessionId),
				eq(subagents.status, 'running'),
			),
		)
		.limit(1);
	if (!rows.length) return undefined;
	const record = rows[0];

	const lastAssistant = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, childSessionId))
		.orderBy(desc(messages.createdAt))
		.limit(5);
	const assistantMessage = lastAssistant.find(
		(message) => message.role === 'assistant',
	);

	let summary = '';
	let failed = false;
	if (assistantMessage) {
		failed =
			assistantMessage.status === 'error' ||
			assistantMessage.finishReason === 'error';
		summary = await extractAssistantText(db, assistantMessage.id);
	}
	if (!summary) {
		summary = failed
			? 'Sub-agent run failed without producing output.'
			: 'Sub-agent finished without a text summary.';
	}

	const status = failed ? 'failed' : 'completed';
	const updatedAt = Date.now();
	await db
		.update(subagents)
		.set({ status, summary, updatedAt })
		.where(eq(subagents.id, record.id));

	logger.info('[subagent] finalized', {
		subagentId: record.id,
		parentSessionId: record.parentSessionId,
		status,
	});

	return { ...record, status, summary, updatedAt };
}

async function extractAssistantText(
	db: DB,
	messageId: string,
): Promise<string> {
	const parts = await db
		.select()
		.from(messageParts)
		.where(eq(messageParts.messageId, messageId))
		.orderBy(asc(messageParts.index));
	const chunks: string[] = [];
	for (const part of parts) {
		if (part.type !== 'text' || !part.content) continue;
		try {
			const parsed = JSON.parse(part.content);
			if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) {
				chunks.push(parsed.text);
			}
		} catch {}
	}
	return chunks.join('\n').trim();
}
