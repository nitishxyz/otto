import type { getDb } from '@ottocode/database';
import { messages, messageParts, sessions } from '@ottocode/database/schema';
import { asc, eq, inArray } from 'drizzle-orm';
import type { ModelMessage } from 'ai';
import {
	parseRecipeInvocation,
	resolveInvokableRecipe,
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

async function shouldExcludeRecipeInvocationFromHistory(args: {
	projectRoot?: string;
	parts: MessagePartRow[];
}): Promise<boolean> {
	if (!args.projectRoot) return false;
	const text = readUserTextPart(args.parts);
	if (!text) return false;
	const invocation = parseRecipeInvocation(text);
	if (!invocation) return false;
	const recipe = await resolveInvokableRecipe(
		args.projectRoot,
		invocation.name,
	);
	return recipe ? !recipe.includeInHistory : false;
}

function readToolPartIdentity(
	part: MessagePartRow,
): { callId: string; name?: string } | null {
	try {
		const value = JSON.parse(part.content ?? '{}') as {
			callId?: unknown;
			name?: unknown;
		};
		if (typeof value.callId !== 'string') return null;
		return {
			callId: value.callId,
			name: typeof value.name === 'string' ? value.name : undefined,
		};
	} catch {
		return null;
	}
}

function buildRetryHistoryPrefix(parts: MessagePartRow[]): MessagePartRow[] {
	const toolCallIndexes = new Map<string, number>();
	const completedCallIds = new Set<string>();
	let lastCompletedResultIndex = -1;

	for (const [index, part] of parts.entries()) {
		if (part.compactedAt) continue;
		if (part.type === 'tool_call') {
			const identity = readToolPartIdentity(part);
			if (identity && identity.name !== 'finish') {
				toolCallIndexes.set(identity.callId, index);
			}
			continue;
		}
		if (part.type !== 'tool_result') continue;

		const identity = readToolPartIdentity(part);
		const toolCallIndex = identity
			? toolCallIndexes.get(identity.callId)
			: undefined;
		if (identity && toolCallIndex !== undefined && toolCallIndex < index) {
			completedCallIds.add(identity.callId);
			lastCompletedResultIndex = index;
		}
	}

	if (lastCompletedResultIndex < 0) return [];
	return parts.slice(0, lastCompletedResultIndex + 1).filter((part) => {
		if (part.type !== 'tool_call' && part.type !== 'tool_result') return true;
		if (part.compactedAt) return true;
		const identity = readToolPartIdentity(part);
		return identity ? completedCallIds.has(identity.callId) : false;
	});
}

/**
 * Builds the conversation history for a session from the database,
 * converting it to the format expected by the AI SDK.
 */
export async function buildHistoryMessages(
	db: Awaited<ReturnType<typeof getDb>>,
	sessionId: string,
	currentMessageId?: string,
	options?: { projectRoot?: string },
): Promise<ModelMessage[]> {
	let rows = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(asc(messages.createdAt));
	const sessionRows = await db
		.select({ compactionMessageId: sessions.compactionMessageId })
		.from(sessions)
		.where(eq(sessions.id, sessionId))
		.limit(1);
	const compactionMessageId = sessionRows[0]?.compactionMessageId;
	if (compactionMessageId) {
		const checkpointIndex = rows.findIndex(
			(message) => message.id === compactionMessageId,
		);
		if (checkpointIndex >= 0) rows = rows.slice(checkpointIndex + 1);
	}
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

		const storedParts = partsByMessageId.get(message.id) ?? [];
		const parts =
			message.id === currentMessageId
				? buildRetryHistoryPrefix(storedParts)
				: storedParts;
		if (message.id === currentMessageId && parts.length === 0) continue;
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
				await shouldExcludeRecipeInvocationFromHistory({
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
