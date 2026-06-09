import { eq, asc } from 'drizzle-orm';
import type { DB } from '@ottocode/database';
import { sessions, messages, messageParts } from '@ottocode/database/schema';
import { publish } from '../../events/bus.ts';
import type { ProviderId } from '@ottocode/sdk';

type SessionRow = typeof sessions.$inferSelect;

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

	const allMessages = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, parentSessionId))
		.orderBy(asc(messages.createdAt));

	const branchPointIndex = allMessages.findIndex((m) => m.id === fromMessageId);
	if (branchPointIndex === -1) {
		throw new Error('Branch point message not found in session');
	}

	const messagesToCopy = allMessages.slice(0, branchPointIndex + 1);

	const newSessionId = crypto.randomUUID();
	const now = Date.now();

	const newSession: typeof sessions.$inferInsert = {
		id: newSessionId,
		title: title || `Branch of ${parent.title || 'Untitled'}`,
		agent: agent || parent.agent,
		provider: provider || parent.provider,
		model: model || parent.model,
		projectPath: parent.projectPath,
		createdAt: now,
		lastActiveAt: now,
		lastViewedAt: now,
		parentSessionId,
		branchPointMessageId: fromMessageId,
		sessionType: 'branch',
	};

	await db.insert(sessions).values(newSession);

	const messageIdMap = new Map<string, string>();
	let copiedParts = 0;

	for (const msg of messagesToCopy) {
		const newMessageId = crypto.randomUUID();
		messageIdMap.set(msg.id, newMessageId);

		const newMessage: typeof messages.$inferInsert = {
			id: newMessageId,
			sessionId: newSessionId,
			role: msg.role,
			status: msg.status,
			agent: msg.agent,
			provider: msg.provider,
			model: msg.model,
			createdAt: msg.createdAt,
			completedAt: msg.completedAt,
			latencyMs: msg.latencyMs,
			inputTokens: msg.inputTokens,
			outputTokens: msg.outputTokens,
			totalTokens: msg.totalTokens,
			cachedInputTokens: msg.cachedInputTokens,
			cacheCreationInputTokens: msg.cacheCreationInputTokens,
			reasoningTokens: msg.reasoningTokens,
			finishReason: msg.finishReason,
			rawFinishReason: msg.rawFinishReason,
			finishDetails: msg.finishDetails,
			error: msg.error,
			errorType: msg.errorType,
			errorDetails: msg.errorDetails,
			isAborted: msg.isAborted,
		};

		await db.insert(messages).values(newMessage);

		const parts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, msg.id))
			.orderBy(asc(messageParts.index));

		for (const part of parts) {
			const newPart: typeof messageParts.$inferInsert = {
				id: crypto.randomUUID(),
				messageId: newMessageId,
				index: part.index,
				stepIndex: part.stepIndex,
				type: part.type,
				content: part.content,
				agent: part.agent,
				provider: part.provider,
				model: part.model,
				startedAt: part.startedAt,
				completedAt: part.completedAt,
				compactedAt: part.compactedAt,
				toolName: part.toolName,
				toolCallId: part.toolCallId,
				toolDurationMs: part.toolDurationMs,
			};

			await db.insert(messageParts).values(newPart);
			copiedParts++;
		}
	}

	const result: SessionRow = {
		id: newSession.id,
		title: newSession.title ?? null,
		agent: newSession.agent,
		provider: newSession.provider,
		model: newSession.model,
		projectPath: newSession.projectPath,
		createdAt: newSession.createdAt,
		lastActiveAt: newSession.lastActiveAt ?? null,
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
		contextSummary: null,
		lastCompactedAt: null,
		parentSessionId: newSession.parentSessionId ?? null,
		branchPointMessageId: newSession.branchPointMessageId ?? null,
		sessionType: newSession.sessionType ?? null,
	};

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
