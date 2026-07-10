import { getDb } from '@ottocode/database';
import {
	messageParts,
	messages,
	sessions,
	shares,
} from '@ottocode/database/schema';
import { loadConfig } from '@ottocode/sdk';
import { eq, inArray } from 'drizzle-orm';
import { userInfo } from 'node:os';

const SHARE_API_URL =
	process.env.OTTO_SHARE_API_URL || 'https://api.share.ottocode.io';

function getUsername(): string {
	try {
		return userInfo().username;
	} catch {
		return 'anonymous';
	}
}

export type ShareSessionResult = {
	shared: true;
	shareId: string;
	url: string;
	message?: string;
};

/** Shares an otto session and returns the public share URL. */
export async function shareSession(args: {
	sessionId: string;
	projectRoot: string;
}): Promise<ShareSessionResult> {
	const cfg = await loadConfig(args.projectRoot);
	const db = await getDb(cfg.projectRoot);

	const session = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, args.sessionId))
		.limit(1);
	if (!session.length) {
		throw new Error('Session not found');
	}

	const existingShare = await db
		.select()
		.from(shares)
		.where(eq(shares.sessionId, args.sessionId))
		.limit(1);
	if (existingShare.length) {
		return {
			shared: true,
			shareId: existingShare[0].shareId,
			url: existingShare[0].url,
			message: 'Already shared',
		};
	}

	const allMessages = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, args.sessionId))
		.orderBy(messages.createdAt);

	if (!allMessages.length) {
		throw new Error('Session has no messages');
	}

	const msgParts = await db
		.select()
		.from(messageParts)
		.where(
			inArray(
				messageParts.messageId,
				allMessages.map((message) => message.id),
			),
		)
		.orderBy(messageParts.index);

	const partsByMessage = new Map<string, typeof msgParts>();
	for (const part of msgParts) {
		const list = partsByMessage.get(part.messageId) || [];
		list.push(part);
		partsByMessage.set(part.messageId, list);
	}

	const lastMessageId = allMessages[allMessages.length - 1].id;
	const sess = session[0];
	const sessionData = {
		title: sess.title,
		username: getUsername(),
		agent: sess.agent,
		provider: sess.provider,
		model: sess.model,
		createdAt: sess.createdAt,
		stats: {
			inputTokens: sess.totalInputTokens ?? 0,
			outputTokens: sess.totalOutputTokens ?? 0,
			cachedTokens: sess.totalCachedTokens ?? 0,
			cacheCreationTokens: sess.totalCacheCreationTokens ?? 0,
			reasoningTokens: sess.totalReasoningTokens ?? 0,
			toolTimeMs: sess.totalToolTimeMs ?? 0,
			toolCounts: sess.toolCountsJson ? JSON.parse(sess.toolCountsJson) : {},
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

	const res = await fetch(`${SHARE_API_URL}/share`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			sessionData,
			title: sess.title,
			lastMessageId,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Failed to create share: ${err}`);
	}

	const data = (await res.json()) as {
		shareId: string;
		secret: string;
		url: string;
	};

	await db.insert(shares).values({
		sessionId: args.sessionId,
		shareId: data.shareId,
		secret: data.secret,
		url: data.url,
		title: sess.title,
		description: null,
		createdAt: Date.now(),
		lastSyncedAt: Date.now(),
		lastSyncedMessageId: lastMessageId,
	});

	return {
		shared: true,
		shareId: data.shareId,
		url: data.url,
	};
}
