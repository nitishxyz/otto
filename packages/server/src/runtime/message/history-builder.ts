import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { asc, eq, inArray } from 'drizzle-orm';
import type { ModelMessage } from 'ai';
import {
	loadProjectRecipe,
	parseRecipeInvocation,
} from '../commands/recipes.ts';
import { getQueueState } from '../session/queue.ts';
import { ToolHistoryTracker } from './tool-history-tracker.ts';
import { appendAssistantHistoryEntries } from './history/assistant-parts.ts';
import { enforceModelHistoryBudget } from './history/budget.ts';
import { findQueuedUserMessageIds } from './history/queue.ts';
import { findSupersededReadPartIds } from './history/read-compaction.ts';
import {
	buildUserModelParts,
	findLatestUserImageMessageId,
} from './history/user-parts.ts';
import type { MessagePartRow } from './history/types.ts';

function groupPartsByMessageId(
	parts: MessagePartRow[],
): Map<string, MessagePartRow[]> {
	const partsByMessageId = new Map<string, MessagePartRow[]>();
	for (const part of parts) {
		const existing = partsByMessageId.get(part.messageId);
		if (existing) {
			existing.push(part);
			continue;
		}
		partsByMessageId.set(part.messageId, [part]);
	}
	return partsByMessageId;
}

function shouldSkipAssistantMessage(args: {
	status: string;
	parts: MessagePartRow[];
}): boolean {
	return (
		args.status !== 'complete' &&
		args.status !== 'completed' &&
		args.status !== 'error' &&
		args.parts.length === 0
	);
}

function readUserTextPart(parts: MessagePartRow[]): string | null {
	for (const part of parts) {
		if (part.type !== 'text') continue;
		try {
			const parsed = JSON.parse(part.content || '{}') as { text?: unknown };
			if (typeof parsed.text === 'string') return parsed.text;
		} catch {
			return part.content;
		}
	}
	return null;
}

async function isRecipeInvocationMessage(args: {
	projectRoot?: string;
	parts: MessagePartRow[];
}): Promise<boolean> {
	if (!args.projectRoot) return false;
	const text = readUserTextPart(args.parts);
	if (!text) return false;
	const invocation = parseRecipeInvocation(text);
	if (!invocation) return false;
	return Boolean(await loadProjectRecipe(args.projectRoot, invocation.name));
}

/**
 * Builds the conversation history for a session from the database,
 * converting it to the format expected by the AI SDK.
 */
export async function buildHistoryMessages(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
	_currentMessageId?: string,
	options?: { projectRoot?: string },
): Promise<ModelMessage[]> {
	const rows = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(asc(messages.createdAt));
	const queuedAssistantMessageIds = new Set(
		getQueueState(sessionId)?.queuedMessages.map((item) => item.messageId) ??
			[],
	);
	const queuedUserMessageIds = findQueuedUserMessageIds(
		rows,
		queuedAssistantMessageIds,
	);
	const messageIds = rows.map((row) => row.id);
	const allParts = messageIds.length
		? await db
				.select()
				.from(messageParts)
				.where(inArray(messageParts.messageId, messageIds))
				.orderBy(asc(messageParts.messageId), asc(messageParts.index))
		: [];
	const partsByMessageId = groupPartsByMessageId(allParts);
	const orderedParts = rows.flatMap(
		(row) => partsByMessageId.get(row.id) ?? [],
	);
	const supersededReadPartIds = findSupersededReadPartIds(orderedParts);
	const latestUserImageMessageId = findLatestUserImageMessageId(
		rows,
		partsByMessageId,
	);

	const history: ModelMessage[] = [];
	const toolHistory = new ToolHistoryTracker();
	let skipNextAssistantMessage = false;

	for (const message of rows) {
		if (
			queuedAssistantMessageIds.has(message.id) ||
			queuedUserMessageIds.has(message.id)
		) {
			continue;
		}

		const parts = partsByMessageId.get(message.id) ?? [];
		if (message.role === 'assistant' && skipNextAssistantMessage) {
			skipNextAssistantMessage = false;
			continue;
		}

		if (
			message.role === 'assistant' &&
			shouldSkipAssistantMessage({ status: message.status, parts })
		) {
			continue;
		}

		if (message.role === 'user') {
			if (
				await isRecipeInvocationMessage({
					projectRoot: options?.projectRoot,
					parts,
				})
			) {
				skipNextAssistantMessage = true;
				continue;
			}

			const userParts = await buildUserModelParts({
				message,
				parts,
				latestUserImageMessageId,
				projectRoot: options?.projectRoot,
			});
			if (userParts.length) {
				history.push({ role: 'user', content: userParts });
			}
			continue;
		}

		if (message.role === 'assistant') {
			await appendAssistantHistoryEntries({
				history,
				parts,
				supersededReadPartIds,
				toolHistory,
			});
		}
	}

	return enforceModelHistoryBudget(history);
}
