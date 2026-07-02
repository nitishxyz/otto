import { and, asc, desc, eq } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { messageParts, messages } from '@ottocode/database/schema';
import { AUTOMATED_PREFIXES } from './stall.ts';
import type { GoalTaskRow } from './types.ts';

const TRANSCRIPT_MESSAGES = 8;
const TRANSCRIPT_PART_LIMIT = 700;

export async function getLastAssistantRun(db: DB, sessionId: string) {
	const rows = await db
		.select({
			id: messages.id,
			status: messages.status,
			finishReason: messages.finishReason,
			isAborted: messages.isAborted,
		})
		.from(messages)
		.where(
			and(eq(messages.sessionId, sessionId), eq(messages.role, 'assistant')),
		)
		.orderBy(desc(messages.createdAt))
		.limit(1);
	return rows[0];
}

export async function getLastManualUserMessageId(
	db: DB,
	sessionId: string,
): Promise<string | null> {
	const rows = await db
		.select({ id: messages.id })
		.from(messages)
		.where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
		.orderBy(desc(messages.createdAt))
		.limit(20);
	for (const row of rows) {
		const parts = await db
			.select({ content: messageParts.content })
			.from(messageParts)
			.where(eq(messageParts.messageId, row.id))
			.orderBy(asc(messageParts.index))
			.limit(1);
		const raw = parts[0]?.content;
		if (!raw) return row.id;
		let text = '';
		try {
			text = String(JSON.parse(raw)?.text ?? '');
		} catch {
			text = raw;
		}
		const automated = AUTOMATED_PREFIXES.some((prefix) =>
			text.trimStart().startsWith(prefix),
		);
		if (!automated) return row.id;
	}
	return null;
}

export function buildStateHash(
	tasks: GoalTaskRow[],
	lastUserMessageId: string | null,
	errored: boolean,
): string {
	const taskPart = tasks.map((task) => `${task.id}:${task.status}`).join('|');
	return `${taskPart}::${lastUserMessageId ?? ''}::${errored ? 'err' : 'ok'}`;
}

/**
 * Builds a compact tail of the worker session conversation (text parts only)
 * so looper can see how the agent answered previous [looper] messages and
 * what the user actually asked for, instead of judging from task state alone.
 */
export async function buildRecentTranscript(
	db: DB,
	sessionId: string,
): Promise<string[]> {
	const rows = await db
		.select({ id: messages.id, role: messages.role })
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(desc(messages.createdAt))
		.limit(TRANSCRIPT_MESSAGES);
	rows.reverse();

	const lines: string[] = [];
	for (const row of rows) {
		const parts = await db
			.select({ type: messageParts.type, content: messageParts.content })
			.from(messageParts)
			.where(eq(messageParts.messageId, row.id))
			.orderBy(asc(messageParts.index));
		const texts: string[] = [];
		for (const part of parts) {
			if (part.type !== 'text' || !part.content) continue;
			try {
				const text = String(JSON.parse(part.content)?.text ?? '').trim();
				if (text) texts.push(text);
			} catch {}
		}
		if (!texts.length) continue;
		let combined = texts.join('\n').replace(/\s+\n/g, '\n').trim();
		if (combined.length > TRANSCRIPT_PART_LIMIT) {
			combined = `${combined.slice(0, TRANSCRIPT_PART_LIMIT)}…`;
		}
		const automated = AUTOMATED_PREFIXES.some((prefix) =>
			combined.trimStart().startsWith(prefix),
		);
		const label =
			row.role === 'assistant' ? 'assistant' : automated ? 'auto' : 'user';
		lines.push(`[${label}] ${combined}`);
	}
	return lines;
}
