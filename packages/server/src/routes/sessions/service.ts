import { getDb } from '@ottocode/database';
import {
	messageParts,
	messages,
	sessions,
	shares,
} from '@ottocode/database/schema';
import {
	hasConfiguredProvider,
	loadConfig,
	logger,
	type ProviderId,
	validateProviderModel,
} from '@ottocode/sdk';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { userInfo } from 'node:os';
import { resolveAgentConfig } from '../../runtime/agent/registry.ts';
import { publish } from '../../events/bus.ts';
import { runSessionLoop } from '../../runtime/agent/runner.ts';
import {
	abortMessage,
	enqueueAssistantRun,
	getQueueState,
	getRunnerState,
	removeFromQueue,
} from '../../runtime/session/queue.ts';

export const SHARE_API_URL =
	process.env.OTTO_SHARE_API_URL || 'https://api.share.ottocode.io';

export type SessionRow = typeof sessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type MessagePartRow = typeof messageParts.$inferSelect;

export type ProjectDbContext = {
	cfg: Awaited<ReturnType<typeof loadConfig>>;
	db: Awaited<ReturnType<typeof getDb>>;
};

export function parseToolCounts(
	toolCountsJson: string | null,
): Record<string, unknown> | undefined {
	if (!toolCountsJson) return undefined;
	try {
		const parsed = JSON.parse(toolCountsJson);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {}
	return undefined;
}

export function normalizeSessionRow(
	row: SessionRow,
	options: { includeRunning?: boolean } = {},
) {
	const { toolCountsJson: _toolCountsJson, ...rest } = row;
	const counts = parseToolCounts(row.toolCountsJson);
	const base = counts ? { ...rest, toolCounts: counts } : rest;
	if (!options.includeRunning) return base;
	const isRunning = getRunnerState(row.id)?.running ?? false;
	return { ...base, isRunning };
}

export async function loadProjectDb(
	projectRoot = process.cwd(),
): Promise<ProjectDbContext> {
	const cfg = await loadConfig(projectRoot);
	const db = await getDb(cfg.projectRoot);
	return { cfg, db };
}

export async function findSessionById(
	db: ProjectDbContext['db'],
	sessionId: string,
) {
	const rows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, sessionId))
		.limit(1);
	return rows[0] ?? null;
}

export async function deleteSessionMessagesAndParts(
	db: ProjectDbContext['db'],
	sessionId: string,
) {
	await db
		.delete(messageParts)
		.where(
			inArray(
				messageParts.messageId,
				db
					.select({ id: messages.id })
					.from(messages)
					.where(eq(messages.sessionId, sessionId)),
			),
		);
	await db.delete(messages).where(eq(messages.sessionId, sessionId));
}

export function getSessionQueueState(sessionId: string) {
	return (
		getQueueState(sessionId) ?? {
			currentMessageId: null,
			queuedMessages: [],
			isRunning: false,
		}
	);
}

async function deleteQueuedAssistantPair(
	db: ProjectDbContext['db'],
	sessionId: string,
	messageId: string,
) {
	const assistantMsg = await db
		.select()
		.from(messages)
		.where(eq(messages.id, messageId))
		.limit(1);

	if (assistantMsg.length === 0) return;

	const userMsg = await db
		.select()
		.from(messages)
		.where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
		.orderBy(desc(messages.createdAt))
		.limit(1);

	const messageIdsToDelete = [messageId];
	if (userMsg.length > 0) {
		messageIdsToDelete.push(userMsg[0].id);
	}

	await db
		.delete(messageParts)
		.where(inArray(messageParts.messageId, messageIdsToDelete));
	await db.delete(messages).where(inArray(messages.id, messageIdsToDelete));
}

export async function removeSessionQueueMessage(
	db: ProjectDbContext['db'],
	sessionId: string,
	messageId: string,
): Promise<
	| { body: { success: true; removed: true; wasQueued: true }; status?: never }
	| {
			body: {
				success: true;
				removed: true;
				wasQueued: false;
				wasRunning: boolean;
			};
			status?: never;
	  }
	| { body: { success: true; removed: true; wasStored: true }; status?: never }
	| { body: { success: false; error: string }; status: 500 }
	| { body: { success: false; removed: false }; status: 404 }
> {
	const removed = removeFromQueue(sessionId, messageId);
	if (removed) {
		try {
			await deleteQueuedAssistantPair(db, sessionId, messageId);
		} catch (err) {
			logger.error('Failed to delete queued messages from DB', err);
		}
		return { body: { success: true, removed: true, wasQueued: true } };
	}

	const result = abortMessage(sessionId, messageId);
	if (result.removed) {
		return {
			body: {
				success: true,
				removed: true,
				wasQueued: false,
				wasRunning: result.wasRunning,
			},
		};
	}

	try {
		const existingMsg = await db
			.select()
			.from(messages)
			.where(and(eq(messages.id, messageId), eq(messages.sessionId, sessionId)))
			.limit(1);

		if (existingMsg.length > 0) {
			await db
				.delete(messageParts)
				.where(
					and(
						eq(messageParts.messageId, messageId),
						or(
							eq(messageParts.type, 'error'),
							and(
								eq(messageParts.type, 'tool_call'),
								eq(messageParts.toolName, 'finish'),
							),
						),
					),
				);
			await db.delete(messages).where(eq(messages.id, messageId));

			return { body: { success: true, removed: true, wasStored: true } };
		}
	} catch (err) {
		logger.error('Failed to delete message from DB', err);
		return {
			body: { success: false, error: 'Failed to delete message' },
			status: 500,
		};
	}

	return { body: { success: false, removed: false }, status: 404 };
}

export async function retryAssistantMessage(
	cfg: ProjectDbContext['cfg'],
	db: ProjectDbContext['db'],
	sessionId: string,
	messageId: string,
): Promise<
	| { ok: true; body: { success: true; messageId: string } }
	| { ok: false; body: { error: string }; status: 400 | 404 }
> {
	const [assistantMsg] = await db
		.select()
		.from(messages)
		.where(
			and(
				eq(messages.id, messageId),
				eq(messages.sessionId, sessionId),
				eq(messages.role, 'assistant'),
			),
		)
		.limit(1);

	if (!assistantMsg) {
		return { ok: false, body: { error: 'Message not found' }, status: 404 };
	}

	if (assistantMsg.status !== 'error' && assistantMsg.status !== 'complete') {
		return {
			ok: false,
			body: { error: 'Can only retry error or complete messages' },
			status: 400,
		};
	}

	const session = await findSessionById(db, sessionId);
	if (!session) {
		return { ok: false, body: { error: 'Session not found' }, status: 404 };
	}

	await db
		.delete(messageParts)
		.where(
			and(
				eq(messageParts.messageId, messageId),
				or(
					eq(messageParts.type, 'error'),
					and(
						eq(messageParts.type, 'tool_call'),
						eq(messageParts.toolName, 'finish'),
					),
				),
			),
		);

	await db
		.update(messages)
		.set({
			status: 'pending',
			error: null,
			errorType: null,
			errorDetails: null,
			completedAt: null,
		})
		.where(eq(messages.id, messageId));

	publish({
		type: 'message.updated',
		sessionId,
		payload: { id: messageId, status: 'pending' },
	});

	const toolApprovalMode = cfg.defaults.toolApproval ?? 'dangerous';

	enqueueAssistantRun(
		{
			sessionId,
			assistantMessageId: messageId,
			agent: assistantMsg.agent ?? 'build',
			provider: (assistantMsg.provider ?? cfg.defaults.provider) as ProviderId,
			model: assistantMsg.model ?? cfg.defaults.model,
			projectRoot: cfg.projectRoot,
			oneShot: false,
			toolApprovalMode,
		},
		runSessionLoop,
	);

	return { ok: true, body: { success: true, messageId } };
}

export type SessionPreferenceUpdates = {
	agent?: string;
	provider?: string;
	model?: string;
	title?: string | null;
	lastActiveAt?: number;
};

export async function buildSessionPreferenceUpdates(
	cfg: ProjectDbContext['cfg'],
	existingSession: SessionRow,
	body: Record<string, unknown>,
): Promise<
	| { ok: true; updates: SessionPreferenceUpdates }
	| { ok: false; error: string; status: 400 }
> {
	const updates: SessionPreferenceUpdates = {
		lastActiveAt: Date.now(),
	};

	if (typeof body.title === 'string') {
		updates.title = body.title.trim() || null;
	}

	if (typeof body.agent === 'string') {
		const agentName = body.agent.trim();
		if (agentName) {
			try {
				await resolveAgentConfig(cfg.projectRoot, agentName);
				updates.agent = agentName;
			} catch {
				return { ok: false, error: `Invalid agent: ${agentName}`, status: 400 };
			}
		}
	}

	if (typeof body.provider === 'string') {
		const providerName = body.provider.trim();
		if (providerName && hasConfiguredProvider(cfg, providerName)) {
			updates.provider = providerName;
		} else if (providerName) {
			return {
				ok: false,
				error: `Invalid provider: ${providerName}`,
				status: 400,
			};
		}
	}

	if (typeof body.model === 'string') {
		const modelName = body.model.trim();
		if (modelName) {
			const targetProvider = (updates.provider ||
				existingSession.provider) as ProviderId;
			try {
				validateProviderModel(targetProvider, modelName, cfg);
			} catch {
				return {
					ok: false,
					error: `Model "${modelName}" not found for provider "${targetProvider}"`,
					status: 400,
				};
			}

			updates.model = modelName;
		}
	}

	return { ok: true, updates };
}

export function getUsername(): string {
	try {
		return userInfo().username;
	} catch {
		return 'anonymous';
	}
}

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
						allMessages.map((m) => m.id),
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
