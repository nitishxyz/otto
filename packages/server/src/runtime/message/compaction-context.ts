import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { eq, asc, desc } from 'drizzle-orm';

export async function buildCompactionContext(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
	contextTokenLimit?: number,
	throughMessageId?: string,
): Promise<string> {
	const sessionMessages = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(desc(messages.createdAt));
	const cutoffIndex = throughMessageId
		? sessionMessages.findIndex((msg) => msg.id === throughMessageId)
		: -1;
	const allMessages =
		cutoffIndex >= 0 ? sessionMessages.slice(cutoffIndex) : sessionMessages;

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
		if (userTurns > 3 && inRecent) inRecent = false;

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
	if (olderLines.length > 0) {
		result.push('[...older conversation (tool data truncated)...]');
		result.push(...olderLines);
		result.push('');
		result.push('[--- Recent conversation (full detail) ---]');
	}
	result.push(...recentLines);

	return result.join('\n');
}
