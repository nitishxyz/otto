import { tool } from 'ai';
import { z } from 'zod/v3';
import { getDb } from '@ottocode/database';
import { sessions, messages, messageParts } from '@ottocode/database/schema';
import { and, eq, asc, count } from 'drizzle-orm';

const inputSchema = z.object({
	sessionId: z.string().describe('The session ID to get context for'),
	includeMessages: z
		.boolean()
		.default(false)
		.describe('Include full message content'),
	messageLimit: z
		.number()
		.min(1)
		.max(100)
		.default(50)
		.describe('Max messages to include if includeMessages is true'),
});

export function buildGetSessionContextTool(projectRoot: string) {
	return {
		name: 'get_session_context',
		tool: tool({
			description:
				'Get detailed context for a specific session including summary, stats, and optionally full messages. Use to understand what happened in a past conversation.',
			inputSchema,
			async execute(input) {
				const db = await getDb(projectRoot);

				const sessionRows = await db
					.select()
					.from(sessions)
					.where(eq(sessions.id, input.sessionId))
					.limit(1);

				if (sessionRows.length === 0) {
					return {
						ok: false,
						error: 'Session not found',
					};
				}

				const session = sessionRows[0];

				if (session.projectPath !== projectRoot) {
					return {
						ok: false,
						error: 'Session belongs to a different project',
					};
				}

				const msgCountResult = await db
					.select({ count: count() })
					.from(messages)
					.where(eq(messages.sessionId, input.sessionId));

				const toolCallsResult = await db
					.select({
						toolName: messageParts.toolName,
						count: count(),
					})
					.from(messageParts)
					.innerJoin(messages, eq(messageParts.messageId, messages.id))
					.where(
						and(
							eq(messages.sessionId, input.sessionId),
							eq(messageParts.type, 'tool_call'),
						),
					)
					.groupBy(messageParts.toolName);

				const uniqueTools: string[] = [];
				let totalToolCalls = 0;
				for (const row of toolCallsResult) {
					if (row.toolName) {
						uniqueTools.push(row.toolName);
						totalToolCalls += Number(row.count);
					}
				}

				const totalTokens =
					(session.totalInputTokens ?? 0) +
					(session.totalOutputTokens ?? 0) +
					(session.totalCachedTokens ?? 0) +
					(session.totalCacheCreationTokens ?? 0);

				const stats = {
					totalMessages: msgCountResult[0]?.count ?? 0,
					totalToolCalls,
					uniqueTools,
					totalTokens,
					totalInputTokens: session.totalInputTokens ?? 0,
					totalOutputTokens: session.totalOutputTokens ?? 0,
					totalCachedTokens: session.totalCachedTokens ?? 0,
					totalCacheCreationTokens: session.totalCacheCreationTokens ?? 0,
				};

				let messagesData:
					| Array<{
							id: string;
							role: string;
							content: string;
							createdAt: number;
					  }>
					| undefined;

				if (input.includeMessages) {
					const msgRows = await db
						.select({
							id: messages.id,
							role: messages.role,
							createdAt: messages.createdAt,
						})
						.from(messages)
						.where(eq(messages.sessionId, input.sessionId))
						.orderBy(asc(messages.createdAt))
						.limit(input.messageLimit);

					messagesData = await Promise.all(
						msgRows.map(async (msg) => {
							const parts = await db
								.select({
									type: messageParts.type,
									content: messageParts.content,
								})
								.from(messageParts)
								.where(eq(messageParts.messageId, msg.id))
								.orderBy(asc(messageParts.index));

							const content = parts
								.filter((p) => p.type === 'text' && p.content)
								.map((p) => p.content)
								.join('\n');

							return {
								id: msg.id,
								role: msg.role,
								content: content.slice(0, 2000),
								createdAt: msg.createdAt,
							};
						}),
					);
				}

				return {
					ok: true,
					session: {
						id: session.id,
						title: session.title,
						agent: session.agent,
						provider: session.provider,
						model: session.model,
						createdAt: session.createdAt,
						lastActiveAt: session.lastActiveAt,
						sessionType: session.sessionType,
						parentSessionId: session.parentSessionId,
					},
					contextSummary: session.contextSummary ?? null,
					stats,
					...(messagesData ? { messages: messagesData } : {}),
				};
			},
		}),
	};
}
