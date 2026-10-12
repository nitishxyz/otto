import { eq, asc } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { sessions, messages, messageParts } from '@ottocode/database/schema';
import { publish } from '../../events/bus.ts';
import type { ProviderId } from '@ottocode/sdk';
import {
	loadSessionMessages,
	loadSessionPartsByMessageId,
} from '../message/session-order.ts';

type SessionRow = typeof sessions.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

export type CreateBranchInput = {
	db: DB;
	parentSessionId: string;
	fromMessageId: string;
	provider?: ProviderId;
	model?: string;
	agent?: string;
	title?: string;
	projectPath: string;
};

export type BranchResult = {
	session: SessionRow;
	parentSessionId: string;
	branchPointMessageId: string;
	copiedMessages: number;
	copiedParts: number;
};

type BranchCheckpoint = Pick<
	SessionRow,
	| 'contextSummary'
	| 'compactionMessageId'
	| 'compactionThroughMessageId'
	| 'lastCompactedAt'
>;

/**
 * Decides which checkpoint state a branch inherits. A branch at or after the
 * parent's summarized-through boundary carries the checkpoint (identities
 * remapped); a branch before it keeps the full evidence with visibility flags
 * cleared and falls back to any inherited handoff context.
 */
function resolveBranchCheckpoint(args: {
	parent: SessionRow;
	messagesToCopy: MessageRow[];
	messageIdMap: Map<string, string>;
}): { checkpoint: BranchCheckpoint; keepCompactionFlags: boolean } {
	const { parent, messagesToCopy, messageIdMap } = args;
	const throughId =
		parent.compactionThroughMessageId ?? parent.compactionMessageId;
	const throughCopied =
		throughId !== null && messagesToCopy.some((m) => m.id === throughId);
	if (parent.contextSummary && throughId && throughCopied) {
		const summaryId = parent.compactionMessageId;
		return {
			checkpoint: {
				contextSummary: parent.contextSummary,
				compactionMessageId: summaryId
					? (messageIdMap.get(summaryId) ?? null)
					: null,
				compactionThroughMessageId: messageIdMap.get(throughId) ?? null,
				lastCompactedAt: parent.lastCompactedAt,
			},
			keepCompactionFlags: true,
		};
	}
	const hasCheckpoint = Boolean(throughId);
	return {
		checkpoint: {
			// Without an applicable checkpoint, only inherited handoff context
			// (or a handoff summary that was never compacted) carries over.
			contextSummary:
				parent.inheritedContext ??
				(hasCheckpoint ? null : parent.contextSummary),
			compactionMessageId: null,
			compactionThroughMessageId: null,
			lastCompactedAt: null,
		},
		keepCompactionFlags: !hasCheckpoint,
	};
}

/**
 * Copies a session prefix into a new branch session in one transaction and
 * publishes `session.created` only after commit.
 */
export async function createBranch({
	db,
	parentSessionId,
	fromMessageId,
	provider,
	model,
	agent,
	title,
	projectPath,
}: CreateBranchInput): Promise<BranchResult> {
	const parentRows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, parentSessionId));

	if (!parentRows.length) {
		throw new Error('Parent session not found');
	}

	const parent = parentRows[0];

	if (parent.projectPath !== projectPath) {
		throw new Error('Parent session not found in this project');
	}

	const branchPointRows = await db
		.select()
		.from(messages)
		.where(eq(messages.id, fromMessageId));

	if (!branchPointRows.length) {
		throw new Error('Branch point message not found');
	}

	const branchPoint = branchPointRows[0];

	if (branchPoint.sessionId !== parentSessionId) {
		throw new Error('Branch point message does not belong to parent session');
	}

	const allMessages = await loadSessionMessages(db, parentSessionId);

	const branchPointIndex = allMessages.findIndex((m) => m.id === fromMessageId);
	if (branchPointIndex === -1) {
		throw new Error('Branch point message not found in session');
	}

	const messagesToCopy = allMessages.slice(0, branchPointIndex + 1);
	const partsByMessageId = await loadSessionPartsByMessageId(
		db,
		parentSessionId,
	);

	const newSessionId = crypto.randomUUID();
	const now = Date.now();

	const messageIdMap = new Map<string, string>();
	for (const msg of messagesToCopy) {
		messageIdMap.set(msg.id, crypto.randomUUID());
	}
	const { checkpoint, keepCompactionFlags } = resolveBranchCheckpoint({
		parent,
		messagesToCopy,
		messageIdMap,
	});

	const result: SessionRow = {
		id: newSessionId,
		title: title || `Branch of ${parent.title || 'Untitled'}`,
		agent: agent || parent.agent,
		provider: provider || parent.provider,
		model: model || parent.model,
		projectPath: parent.projectPath,
		createdAt: now,
		lastActiveAt: now,
		lastViewedAt: now,
		pinnedAt: null,
		totalInputTokens: null,
		totalOutputTokens: null,
		totalCachedTokens: null,
		totalCacheCreationTokens: null,
		totalReasoningTokens: null,
		totalToolTimeMs: null,
		toolCountsJson: null,
		currentContextTokens: null,
		...checkpoint,
		inheritedContext: parent.inheritedContext,
		parentSessionId,
		branchPointMessageId: fromMessageId,
		sessionType: 'branch',
	};

	let copiedParts = 0;
	db.transaction((tx) => {
		tx.insert(sessions).values(result).run();
		for (const [sequenceIndex, msg] of messagesToCopy.entries()) {
			const newMessageId = messageIdMap.get(msg.id) as string;
			tx.insert(messages)
				.values({
					...msg,
					id: newMessageId,
					sessionId: newSessionId,
					sequence: sequenceIndex + 1,
				})
				.run();
			const parts = partsByMessageId.get(msg.id) ?? [];
			if (parts.length === 0) continue;
			const copies = parts.map((part) => ({
				...part,
				id: crypto.randomUUID(),
				messageId: newMessageId,
				compactedAt: keepCompactionFlags ? part.compactedAt : null,
			}));
			for (let start = 0; start < copies.length; start += 500) {
				tx.insert(messageParts)
					.values(copies.slice(start, start + 500))
					.run();
			}
			copiedParts += parts.length;
		}
	});

	publish({
		type: 'session.created',
		sessionId: newSessionId,
		payload: result,
	});

	return {
		session: result,
		parentSessionId,
		branchPointMessageId: fromMessageId,
		copiedMessages: messagesToCopy.length,
		copiedParts,
	};
}

export type ListBranchesResult = Array<{
	session: SessionRow;
	branchPointMessageId: string | null;
	branchPointPreview: string | null;
	createdAt: number;
}>;

export async function listBranches(
	db: DB,
	sessionId: string,
	projectPath: string,
): Promise<ListBranchesResult> {
	const branches = await db
		.select()
		.from(sessions)
		.where(eq(sessions.parentSessionId, sessionId))
		.orderBy(asc(sessions.createdAt));

	const results: ListBranchesResult = [];

	for (const branch of branches) {
		if (branch.projectPath !== projectPath) continue;

		let preview: string | null = null;

		if (branch.branchPointMessageId) {
			const msgRows = await db
				.select()
				.from(messages)
				.where(eq(messages.id, branch.branchPointMessageId));

			if (msgRows.length > 0) {
				const parts = await db
					.select()
					.from(messageParts)
					.where(eq(messageParts.messageId, branch.branchPointMessageId))
					.orderBy(asc(messageParts.index));

				for (const part of parts) {
					if (part.type === 'text') {
						try {
							const content = JSON.parse(part.content || '{}');
							if (content.text) {
								preview = content.text.slice(0, 100);
								break;
							}
						} catch {}
					}
				}
			}
		}

		results.push({
			session: branch,
			branchPointMessageId: branch.branchPointMessageId,
			branchPointPreview: preview,
			createdAt: branch.createdAt,
		});
	}

	return results;
}

export async function getParentSession(
	db: DB,
	sessionId: string,
	projectPath: string,
): Promise<SessionRow | null> {
	const sessionRows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, sessionId));

	if (!sessionRows.length) return null;

	const session = sessionRows[0];
	if (!session.parentSessionId) return null;

	const parentRows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, session.parentSessionId));

	if (!parentRows.length) return null;

	const parent = parentRows[0];
	if (parent.projectPath !== projectPath) return null;

	return parent;
}
