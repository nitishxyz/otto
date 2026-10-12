import type { getDb } from '@ottocode/database';
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
import {
	buildUserModelParts,
	findLatestUserImageMessageId,
} from './history/user-parts.ts';
import type { MessagePartRow } from './history/types.ts';
import {
	loadSessionMessages,
	loadSessionPartsByMessageId,
	readCheckpointBoundary,
	splitAtCheckpoint,
} from './session-order.ts';

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

/** Resolves each distinct recipe invocation once per history build. */
function createRecipeHistoryFilter(projectRoot?: string) {
	const decisions = new Map<string, Promise<boolean>>();
	return (parts: MessagePartRow[]): Promise<boolean> => {
		if (!projectRoot) return Promise.resolve(false);
		const text = readUserTextPart(parts);
		if (!text) return Promise.resolve(false);
		const invocation = parseRecipeInvocation(text);
		if (!invocation) return Promise.resolve(false);
		let decision = decisions.get(invocation.name);
		if (!decision) {
			decision = resolveInvokableRecipe(projectRoot, invocation.name).then(
				(recipe) => (recipe ? !recipe.includeInHistory : false),
			);
			decisions.set(invocation.name, decision);
		}
		return decision;
	};
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
	const [allRows, boundary] = await Promise.all([
		loadSessionMessages(db, sessionId),
		readCheckpointBoundary(db, sessionId),
	]);
	// History resumes after the summarized-through boundary; the summary
	// message itself is never replayed (its content lives in the system prompt).
	const { after: rows, boundaryRow } = splitAtCheckpoint(allRows, boundary);
	const partsByMessageId = await loadSessionPartsByMessageId(
		db,
		sessionId,
		boundaryRow?.sequence,
	);
	const queuedAssistantMessageIds = new Set(
		getQueueState(
			sessionId,
			options?.projectRoot ?? boundary.projectPath ?? undefined,
		)?.queuedMessages.map((item) => item.messageId) ?? [],
	);
	const queuedUserMessageIds = findQueuedUserMessageIds(
		rows,
		queuedAssistantMessageIds,
	);
	const orderedParts = rows.flatMap(
		(row) => partsByMessageId.get(row.id) ?? [],
	);
	// Supersession is computed over stored parts before model conversion.
	const toolHistory = ToolHistoryTracker.fromParts(orderedParts);
	const latestUserImageMessageId = findLatestUserImageMessageId(
		rows,
		partsByMessageId,
	);
	const excludeRecipeInvocation = createRecipeHistoryFilter(
		options?.projectRoot,
	);

	const history: ModelMessage[] = [];
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
			if (await excludeRecipeInvocation(parts)) {
				skipNextAssistantMessage = true;
				continue;
			}

			const userParts = buildUserModelParts({
				message,
				parts,
				latestUserImageMessageId,
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
				toolHistory,
			});
		}
	}

	return enforceModelHistoryBudget(history);
}
