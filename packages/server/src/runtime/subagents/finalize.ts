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
	const updatedAt = Math.max(Date.now(), record.updatedAt + 1);
	await db
		.update(subagents)
		.set({ status, summary, reported: false, updatedAt })
		.where(eq(subagents.id, record.id));

	logger.info('[subagent] finalized', {
		subagentId: record.id,
		parentSessionId: record.parentSessionId,
		status,
	});

	return { ...record, status, summary, reported: false, updatedAt };
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
