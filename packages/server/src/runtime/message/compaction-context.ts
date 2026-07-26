import type { getDb } from '@ottocode/database';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import { eq, asc, desc } from 'drizzle-orm';

const PREVIOUS_CHECKPOINT_MAX_CHARS = 6_000;

export async function buildCompactionContext(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
	contextTokenLimit?: number,
	throughMessageId?: string,
): Promise<string> {
	const sessionRows = await db
		.select({
			contextSummary: sessions.contextSummary,
			compactionMessageId: sessions.compactionMessageId,
		})
		.from(sessions)
		.where(eq(sessions.id, sessionId))
		.limit(1);
	const previousCheckpoint = sessionRows[0]?.contextSummary?.trim() ?? '';
	const compactionMessageId = sessionRows[0]?.compactionMessageId ?? undefined;
	const sessionMessages = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(desc(messages.createdAt));
	const cutoffIndex = throughMessageId
		? sessionMessages.findIndex((msg) => msg.id === throughMessageId)
		: -1;
	let allMessages =
		cutoffIndex >= 0 ? sessionMessages.slice(cutoffIndex) : sessionMessages;
	const checkpointIndex = compactionMessageId
		? allMessages.findIndex((msg) => msg.id === compactionMessageId)
		: -1;
	if (checkpointIndex >= 0) {
		allMessages = allMessages.slice(0, checkpointIndex);
	}

	const maxChars = contextTokenLimit ? contextTokenLimit * 4 : 60000;
	const recentBudget = Math.floor(maxChars * 0.65);
	const olderBudget = maxChars - recentBudget;

	const recentLines: string[] = [];
	const olderLines: string[] = [];
	let recentChars = 0;
	let olderChars = 0;
	let userTurns = 0;
	let inRecent = true;

	for (const msg of allMessages) {
		if (msg.role === 'user') userTurns++;
		if (userTurns > 1 && inRecent) inRecent = false;

		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, msg.id))
			.orderBy(asc(messageParts.index));

		for (const part of parts) {
			if (part.compactedAt) continue;

			try {
				const content = JSON.parse(part.content ?? '{}');

				if (part.type === 'text' && content.text) {
					const text = `[${msg.role.toUpperCase()}]: ${content.text}`;
					const limit = inRecent ? 3000 : 1000;
					const line = text.slice(0, limit);

					if (inRecent && recentChars < recentBudget) {
						recentLines.unshift(line);
						recentChars += line.length;
					} else if (olderChars < olderBudget) {
						olderLines.unshift(line);
						olderChars += line.length;
					}
				} else if (part.type === 'tool_call' && content.name) {
					if (inRecent && recentChars < recentBudget) {
						const argsStr =
							typeof content.args === 'object'
								? JSON.stringify(content.args).slice(0, 1000)
								: '';
						const line = `[TOOL ${content.name}]: ${argsStr}`;
						recentLines.unshift(line);
						recentChars += line.length;
					} else if (olderChars < olderBudget) {
						const line = `[TOOL ${content.name}]`;
						olderLines.unshift(line);
						olderChars += line.length;
					}
				} else if (part.type === 'tool_result' && content.result !== null) {
					const resultStr =
						typeof content.result === 'string'
							? content.result
							: JSON.stringify(content.result ?? '');

					if (inRecent && recentChars < recentBudget) {
						const line = `[RESULT]: ${resultStr.slice(0, 2000)}`;
						recentLines.unshift(line);
						recentChars += line.length;
					} else if (olderChars < olderBudget) {
						const line = `[RESULT]: ${resultStr.slice(0, 150)}...`;
						olderLines.unshift(line);
						olderChars += line.length;
					}
				}
			} catch {}
		}

		if (olderChars >= olderBudget) break;
	}

	const result: string[] = [];
	if (previousCheckpoint) {
		result.push('[--- PREVIOUS CHECKPOINT (merge and replace) ---]');
		result.push(previousCheckpoint.slice(0, PREVIOUS_CHECKPOINT_MAX_CHARS));
		result.push('');
		result.push('[--- POST-CHECKPOINT CONVERSATION ---]');
	}
	if (olderLines.length > 0) {
		result.push('[...older conversation (tool data truncated)...]');
		result.push(...olderLines);
		result.push('');
		result.push('[--- Latest turn evidence (bounded) ---]');
	}
	result.push(...recentLines);

	return result.join('\n');
}
