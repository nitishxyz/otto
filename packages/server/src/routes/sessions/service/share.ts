import {
	messageParts,
	messages,
	sessions,
	shares,
} from '@ottocode/database/schema';
import { desc, eq, inArray } from 'drizzle-orm';
import { findSessionById } from './core.ts';
import { getUsername } from './preferences.ts';
import type {
	MessagePartRow,
	MessageRow,
	ProjectDbContext,
	SessionRow,
} from './types.ts';

export const SHARE_API_URL =
	process.env.OTTO_SHARE_API_URL || 'https://api.share.ottocode.io';

export function groupPartsByMessage(parts: MessagePartRow[]) {
	const partsByMessage = new Map<string, MessagePartRow[]>();
	for (const part of parts) {
		const list = partsByMessage.get(part.messageId) || [];
		list.push(part);
		partsByMessage.set(part.messageId, list);
	}
	return partsByMessage;
}

export async function loadSessionMessagesWithParts(
	db: ProjectDbContext['db'],
	sessionId: string,
) {
	const allMessages = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(messages.createdAt);

	const msgParts = allMessages.length
		? await db
				.select()
				.from(messageParts)
				.where(
					inArray(
						messageParts.messageId,
						allMessages.map((message) => message.id),
					),
				)
				.orderBy(messageParts.index)
		: [];

	return {
		allMessages,
		partsByMessage: groupPartsByMessage(msgParts),
	};
}

export function buildShareSessionData(
	session: SessionRow,
	allMessages: MessageRow[],
	partsByMessage: Map<string, MessagePartRow[]>,
) {
	return {
		title: session.title,
		username: getUsername(),
		agent: session.agent,
		provider: session.provider,
		model: session.model,
		createdAt: session.createdAt,
		stats: {
			inputTokens: session.totalInputTokens ?? 0,
			outputTokens: session.totalOutputTokens ?? 0,
			cachedTokens: session.totalCachedTokens ?? 0,
			cacheCreationTokens: session.totalCacheCreationTokens ?? 0,
			reasoningTokens: session.totalReasoningTokens ?? 0,
			toolTimeMs: session.totalToolTimeMs ?? 0,
			toolCounts: session.toolCountsJson
				? JSON.parse(session.toolCountsJson)
				: {},
		},
		messages: allMessages.map((message) => ({
			id: message.id,
			role: message.role,
			createdAt: message.createdAt,
			parts: (partsByMessage.get(message.id) || []).map((part) => ({
				type: part.type,
				content: part.content,
				toolName: part.toolName,
				toolCallId: part.toolCallId,
			})),
		})),
	};
}

export async function getShareStatus(
	db: ProjectDbContext['db'],
	sessionId: string,
) {
	const share = await db
		.select()
		.from(shares)
		.where(eq(shares.sessionId, sessionId))
		.limit(1);

	if (!share.length) {
		return { shared: false };
	}

	const allMessages = await db
		.select({ id: messages.id })
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(messages.createdAt);

	const totalMessages = allMessages.length;
	const syncedIdx = allMessages.findIndex(
		(message) => message.id === share[0].lastSyncedMessageId,
	);
	const syncedMessages = syncedIdx === -1 ? 0 : syncedIdx + 1;
	const pendingMessages = totalMessages - syncedMessages;

	return {
		shared: true,
		shareId: share[0].shareId,
		url: share[0].url,
		title: share[0].title,
		createdAt: share[0].createdAt,
		lastSyncedAt: share[0].lastSyncedAt,
		lastSyncedMessageId: share[0].lastSyncedMessageId,
		syncedMessages,
		totalMessages,
		pendingMessages,
		isSynced: pendingMessages === 0,
	};
}

export async function createShare(
	db: ProjectDbContext['db'],
	sessionId: string,
): Promise<
	| { ok: true; body: { shared: true; shareId: string; url: string } }
	| { ok: false; body: { error: string }; status: 400 | 404 | 500 }
	| {
			ok: true;
			body: { shared: true; shareId: string; url: string; message: string };
	  }
> {
	const session = await findSessionById(db, sessionId);
	if (!session) {
		return { ok: false, body: { error: 'Session not found' }, status: 404 };
	}

	const existingShare = await db
		.select()
		.from(shares)
		.where(eq(shares.sessionId, sessionId))
		.limit(1);
	if (existingShare.length) {
		return {
			ok: true,
			body: {
				shared: true,
				shareId: existingShare[0].shareId,
				url: existingShare[0].url,
				message: 'Already shared',
			},
		};
	}

	const { allMessages, partsByMessage } = await loadSessionMessagesWithParts(
		db,
		sessionId,
	);

	if (!allMessages.length) {
		return {
			ok: false,
			body: { error: 'Session has no messages' },
			status: 400,
		};
	}

	const lastMessageId = allMessages[allMessages.length - 1].id;
	const sessionData = buildShareSessionData(
		session,
		allMessages,
		partsByMessage,
	);

	const res = await fetch(`${SHARE_API_URL}/share`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			sessionData,
			title: session.title,
			lastMessageId,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		return {
			ok: false,
			body: { error: `Failed to create share: ${err}` },
			status: 500,
		};
	}

	const data = (await res.json()) as {
		shareId: string;
		secret: string;
		url: string;
	};

	await db.insert(shares).values({
		sessionId,
		shareId: data.shareId,
		secret: data.secret,
		url: data.url,
		title: session.title,
		description: null,
		createdAt: Date.now(),
		lastSyncedAt: Date.now(),
		lastSyncedMessageId: lastMessageId,
	});

	return {
		ok: true,
		body: {
			shared: true,
			shareId: data.shareId,
			url: data.url,
		},
	};
}

export async function syncShare(
	db: ProjectDbContext['db'],
	sessionId: string,
): Promise<
	| { ok: true; body: { synced: true; url: string; newMessages: number } }
	| {
			ok: true;
			body: { synced: true; url: string; newMessages: 0; message: string };
	  }
	| { ok: false; body: { error: string }; status: 400 | 404 | 500 }
> {
	const share = await db
		.select()
		.from(shares)
		.where(eq(shares.sessionId, sessionId))
		.limit(1);
	if (!share.length) {
		return {
			ok: false,
			body: { error: 'Session not shared. Use share first.' },
			status: 400,
		};
	}

	const session = await findSessionById(db, sessionId);
	if (!session) {
		return { ok: false, body: { error: 'Session not found' }, status: 404 };
	}

	const { allMessages, partsByMessage } = await loadSessionMessagesWithParts(
		db,
		sessionId,
	);

	const lastSyncedIdx = allMessages.findIndex(
		(message) => message.id === share[0].lastSyncedMessageId,
	);
	const newMessages =
		lastSyncedIdx === -1 ? allMessages : allMessages.slice(lastSyncedIdx + 1);
	const lastMessageId =
		allMessages[allMessages.length - 1]?.id ?? share[0].lastSyncedMessageId;

	if (newMessages.length === 0) {
		return {
			ok: true,
			body: {
				synced: true,
				url: share[0].url,
				newMessages: 0,
				message: 'Already synced',
			},
		};
	}

	const sessionData = buildShareSessionData(
		session,
		allMessages,
		partsByMessage,
	);

	const res = await fetch(`${SHARE_API_URL}/share/${share[0].shareId}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
			'X-Share-Secret': share[0].secret,
		},
		body: JSON.stringify({
			sessionData,
			title: session.title,
			lastMessageId,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		return {
			ok: false,
			body: { error: `Failed to sync share: ${err}` },
			status: 500,
		};
	}

	await db
		.update(shares)
		.set({
			title: session.title,
			lastSyncedAt: Date.now(),
			lastSyncedMessageId: lastMessageId,
		})
		.where(eq(shares.sessionId, sessionId));

	return {
		ok: true,
		body: {
			synced: true,
			url: share[0].url,
			newMessages: newMessages.length,
		},
	};
}

export async function deleteShare(
	db: ProjectDbContext['db'],
	sessionId: string,
): Promise<
	| { ok: true; body: { deleted: true; sessionId: string } }
	| { ok: false; body: { error: string }; status: 404 | 500 }
> {
	const share = await db
		.select()
		.from(shares)
		.where(eq(shares.sessionId, sessionId))
		.limit(1);

	if (!share.length) {
		return {
			ok: false,
			body: { error: 'Session is not shared' },
			status: 404,
		};
	}

	try {
		const res = await fetch(`${SHARE_API_URL}/share/${share[0].shareId}`, {
			method: 'DELETE',
			headers: { 'X-Share-Secret': share[0].secret },
		});

		if (!res.ok && res.status !== 404) {
			const err = await res.text();
			return {
				ok: false,
				body: { error: `Failed to delete share: ${err}` },
				status: 500,
			};
		}
	} catch {}

	await db.delete(shares).where(eq(shares.sessionId, sessionId));

	return { ok: true, body: { deleted: true, sessionId } };
}

export async function listShares(
	cfg: ProjectDbContext['cfg'],
	db: ProjectDbContext['db'],
) {
	return db
		.select({
			sessionId: shares.sessionId,
			shareId: shares.shareId,
			url: shares.url,
			title: shares.title,
			createdAt: shares.createdAt,
			lastSyncedAt: shares.lastSyncedAt,
		})
		.from(shares)
		.innerJoin(sessions, eq(shares.sessionId, sessions.id))
		.where(eq(sessions.projectPath, cfg.projectRoot))
		.orderBy(desc(shares.lastSyncedAt));
}
