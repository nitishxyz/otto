import { and, asc, desc, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { messageParts, messages, subagents } from '@ottocode/database/schema';
import { logger } from '@ottocode/sdk';
import { attemptOf, terminateSubagentAttempt } from './transitions.ts';
import type { SubagentRecord } from './types.ts';

/**
 * Finalizes the current running attempt of a child session whose run just
 * finished. The finished assistant message is identified explicitly (by id
 * when known, otherwise the newest assistant message). Nothing is finalized
 * while that message is still pending (a queued follow-up has not run yet).
 * The terminal write is compare-and-set against the attempt version, so a
 * concurrent stop or follow-up wins and this call becomes a no-op.
 * Returns the updated record, or undefined when nothing was finalized.
 */
export async function finalizeSubagentForChildSession(
	db: DB,
	childSessionId: string,
	options: { finishedMessageId?: string } = {},
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
		.orderBy(desc(subagents.createdAt))
		.limit(1);
	const record = rows[0];
	if (!record) return undefined;
	const attempt = attemptOf(record);
	if (
		options.finishedMessageId &&
		record.attemptId &&
		record.attemptId !== options.finishedMessageId
	)
		return undefined;

	const [assistantMessage] = await db
		.select()
		.from(messages)
		.where(
			and(
				eq(messages.sessionId, childSessionId),
				eq(messages.role, 'assistant'),
				...(options.finishedMessageId
					? [eq(messages.id, options.finishedMessageId)]
					: []),
			),
		)
		.orderBy(desc(messages.createdAt))
		.limit(1);
	if (assistantMessage?.status === 'pending') {
		logger.debug('[subagent] finalize skipped: assistant message pending', {
			subagentId: record.id,
			messageId: assistantMessage.id,
		});
		return undefined;
	}
	if (record.attemptId && assistantMessage?.id !== record.attemptId)
		return undefined;

	let summary = '';
	let failed = false;
	if (assistantMessage) {
		failed =
			assistantMessage.status === 'error' ||
			assistantMessage.finishReason === 'error';
		summary = await extractAssistantText(db, assistantMessage.id);
		if (failed) {
			const errorSummary = buildAssistantErrorSummary(assistantMessage);
			if (errorSummary) {
				summary = summary ? `${summary}\n\n${errorSummary}` : errorSummary;
			}
		}
	}
	if (!summary) {
		summary = failed
			? 'Sub-agent run failed without producing output.'
			: 'Sub-agent finished without a text summary.';
	}

	const status = failed ? 'failed' : 'completed';
	const updated = terminateSubagentAttempt(db, attempt, {
		status,
		summary,
		reported: false,
		finishedMessageId: assistantMessage?.id ?? null,
	});
	if (!updated) {
		logger.info('[subagent] finalize superseded by concurrent transition', {
			subagentId: record.id,
			attemptSeq: attempt.attemptSeq,
		});
		return undefined;
	}

	logger.info('[subagent] finalized', {
		subagentId: record.id,
		parentSessionId: record.parentSessionId,
		status,
		messageId: assistantMessage?.id,
	});

	return updated;
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

function buildAssistantErrorSummary(
	assistantMessage: typeof messages.$inferSelect,
): string {
	const lines = ['Sub-agent run failed.'];
	if (assistantMessage.error?.trim()) {
		lines.push(`Error: ${assistantMessage.error.trim()}`);
	}
	if (assistantMessage.errorType?.trim()) {
		lines.push(`Type: ${assistantMessage.errorType.trim()}`);
	}
	const details = extractErrorDetails(assistantMessage.errorDetails);
	if (details.length) lines.push(...details);
	return lines.length > 1 ? lines.join('\n') : '';
}

function extractErrorDetails(errorDetails: string | null): string[] {
	if (!errorDetails) return [];
	try {
		const parsed = JSON.parse(errorDetails) as unknown;
		const detailLines: string[] = [];
		if (parsed && typeof parsed === 'object') {
			const record = parsed as Record<string, unknown>;
			const name = readString(record.name);
			const message = readString(record.message);
			const type = readString(record.type);
			if (name) detailLines.push(`Name: ${name}`);
			if (type) detailLines.push(`Provider type: ${type}`);
			if (message) detailLines.push(`Details: ${message}`);
		}
		return detailLines;
	} catch {
		return [`Details: ${errorDetails}`];
	}
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
