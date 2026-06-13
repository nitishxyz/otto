import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { OttoConfig } from '@ottocode/sdk';
import type { DB } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import {
	validateProviderModel,
	isProviderAuthorized,
	ensureProviderEnv,
	type ProviderId,
} from '@ottocode/sdk';
import { publish } from '../../events/bus.ts';

type SessionRow = typeof sessions.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type MessagePartRow = typeof messageParts.$inferSelect;

type CreateSessionInput = {
	db: DB;
	cfg: OttoConfig;
	agent: string;
	provider: ProviderId;
	model: string;
	allowUnknownModel?: boolean;
	title?: string | null;
	parentSessionId?: string | null;
	sessionType?:
		| 'main'
		| 'branch'
		| 'handoff'
		| 'research'
		| 'btw'
		| 'subagent'
		| 'otto';
};

export async function createSession({
	db,
	cfg,
	agent,
	provider,
	model,
	allowUnknownModel,
	title,
	parentSessionId,
	sessionType = 'main',
}: CreateSessionInput): Promise<SessionRow> {
	validateProviderModel(provider, model, cfg, { allowUnknownModel });
	const authorized = await isProviderAuthorized(cfg, provider);
	if (!authorized) {
		throw new Error(
			`Provider ${provider} is not configured. Run \`otto auth login\` to add credentials.`,
		);
	}
	await ensureProviderEnv(cfg, provider);
	const id = crypto.randomUUID();
	const now = Date.now();
	const row: SessionRow = {
		id,
		title: title ?? null,
		agent,
		provider,
		model,
		projectPath: cfg.projectRoot,
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
		contextSummary: null,
		lastCompactedAt: null,
		parentSessionId: parentSessionId ?? null,
		branchPointMessageId: null,
		sessionType,
	};
	await db.insert(sessions).values(row);
	publish({ type: 'session.created', sessionId: id, payload: row });
	return row;
}

type GetSessionInput = {
	db: DB;
	projectPath?: string;
	sessionId: string;
};

export async function getSessionById({
	db,
	projectPath,
	sessionId,
}: GetSessionInput): Promise<SessionRow | undefined> {
	const rows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, sessionId));
	if (!rows.length) return undefined;
	const row = rows[0];
	if (projectPath && row.projectPath !== projectPath) return undefined;
	return row;
}

type GetLastSessionInput = { db: DB; projectPath: string };

export async function getLastSession({
	db,
	projectPath,
}: GetLastSessionInput): Promise<SessionRow | undefined> {
	const rows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.projectPath, projectPath))
		.orderBy(desc(sessions.lastActiveAt), desc(sessions.createdAt))
		.limit(1);
	return rows[0];
}

type ListSessionsInput = {
	db: DB;
	projectPath?: string;
	limit?: number;
};

export async function listSessions({
	db,
	projectPath,
	limit = 100,
}: ListSessionsInput): Promise<SessionRow[]> {
	return await db
		.select()
		.from(sessions)
		.where(
			projectPath
				? and(
						eq(sessions.projectPath, projectPath),
						ne(sessions.sessionType, 'research'),
						ne(sessions.sessionType, 'btw'),
						ne(sessions.sessionType, 'subagent'),
						ne(sessions.sessionType, 'otto'),
					)
				: and(
						ne(sessions.sessionType, 'research'),
						ne(sessions.sessionType, 'btw'),
						ne(sessions.sessionType, 'subagent'),
						ne(sessions.sessionType, 'otto'),
					),
		)
		.orderBy(
			desc(sql`${sessions.pinnedAt} IS NOT NULL`),
			desc(sessions.lastActiveAt),
			desc(sessions.createdAt),
		)
		.limit(limit);
}

type UpdateSessionAgentInput = {
	db: DB;
	sessionId: string;
	agent: string;
};

export async function updateSessionAgent({
	db,
	sessionId,
	agent,
}: UpdateSessionAgentInput): Promise<void> {
	await db
		.update(sessions)
		.set({ agent, lastActiveAt: Date.now() })
		.where(eq(sessions.id, sessionId));
}

export type SessionHistoryMessage = MessageRow & {
	parts: MessagePartRow[];
};

export async function getSessionHistoryMessages(
	db: DB,
	sessionId: string,
): Promise<SessionHistoryMessage[]> {
	const rows = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(asc(messages.createdAt));
	const messageIds = rows.map((message) => message.id);
	const parts = messageIds.length
		? await db
				.select()
				.from(messageParts)
				.where(inArray(messageParts.messageId, messageIds))
				.orderBy(asc(messageParts.messageId), asc(messageParts.index))
		: [];
	const partsByMessageId = new Map<string, MessagePartRow[]>();
	for (const part of parts) {
		const existing = partsByMessageId.get(part.messageId);
		if (existing) existing.push(part);
		else partsByMessageId.set(part.messageId, [part]);
	}
	return rows.map((message) => ({
		...message,
		parts: (partsByMessageId.get(message.id) ?? []).sort(
			(a, b) => a.index - b.index,
		),
	}));
}
