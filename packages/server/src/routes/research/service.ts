import type { Context } from 'hono';
import { getDb } from '@ottocode/database';
import { messageParts, messages, sessions } from '@ottocode/database/schema';
import {
	hasConfiguredProvider,
	loadConfig,
	logger,
	type ProviderId,
} from '@ottocode/sdk';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { publish } from '../../events/bus.ts';
import { serializeError } from '../../runtime/errors/api-error.ts';

async function loadProjectDb(projectRoot: string) {
	const cfg = await loadConfig(projectRoot);
	const db = await getDb(cfg.projectRoot);
	return { cfg, db };
}

async function buildResearchContext(
	db: Awaited<ReturnType<typeof getDb>>,
	researchSessionId: string,
) {
	const researchMessages = await db
		.select({
			id: messages.id,
			role: messages.role,
			createdAt: messages.createdAt,
		})
		.from(messages)
		.where(eq(messages.sessionId, researchSessionId))
		.orderBy(asc(messages.createdAt));

	let contextContent = '';
	for (const msg of researchMessages) {
		if (msg.role === 'user' || msg.role === 'assistant') {
			const parts = await db
				.select({ type: messageParts.type, content: messageParts.content })
				.from(messageParts)
				.where(eq(messageParts.messageId, msg.id))
				.orderBy(asc(messageParts.index));

			for (const part of parts) {
				if (part.type === 'text' && part.content) {
					contextContent += `[${msg.role}]: ${part.content}\n\n`;
				}
			}
		}
	}

	return contextContent;
}

export async function listResearchSessions(c: Context) {
	const parentId = c.req.param('parentId');
	const projectRoot = c.req.query('project') || process.cwd();
	const { cfg, db } = await loadProjectDb(projectRoot);

	const parentRows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, parentId))
		.limit(1);

	if (!parentRows.length || parentRows[0].projectPath !== cfg.projectRoot) {
		return c.json({ error: 'Parent session not found' }, 404);
	}

	const researchRows = await db
		.select({
			id: sessions.id,
			title: sessions.title,
			createdAt: sessions.createdAt,
			lastActiveAt: sessions.lastActiveAt,
			provider: sessions.provider,
			model: sessions.model,
			totalInputTokens: sessions.totalInputTokens,
			totalOutputTokens: sessions.totalOutputTokens,
			totalCachedTokens: sessions.totalCachedTokens,
			totalCacheCreationTokens: sessions.totalCacheCreationTokens,
		})
		.from(sessions)
		.where(
			and(
				eq(sessions.parentSessionId, parentId),
				eq(sessions.sessionType, 'research'),
			),
		)
		.orderBy(desc(sessions.lastActiveAt), desc(sessions.createdAt));

	const sessionsWithCounts = await Promise.all(
		researchRows.map(async (row) => {
			const msgCount = await db
				.select({ count: count() })
				.from(messages)
				.where(eq(messages.sessionId, row.id));
			return { ...row, messageCount: msgCount[0]?.count ?? 0 };
		}),
	);

	return c.json({ sessions: sessionsWithCounts });
}

export async function createResearchSession(c: Context) {
	const parentId = c.req.param('parentId');
	const projectRoot = c.req.query('project') || process.cwd();
	const { cfg, db } = await loadProjectDb(projectRoot);
	const body = (await c.req.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;

	const parentRows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, parentId))
		.limit(1);

	if (!parentRows.length || parentRows[0].projectPath !== cfg.projectRoot) {
		return c.json({ error: 'Parent session not found' }, 404);
	}

	const parent = parentRows[0];
	const providerCandidate =
		typeof body.provider === 'string' ? body.provider : undefined;
	const provider: ProviderId =
		providerCandidate && hasConfiguredProvider(cfg, providerCandidate)
			? providerCandidate
			: (parent.provider as ProviderId);
	const modelCandidate =
		typeof body.model === 'string' ? body.model.trim() : undefined;
	const model = modelCandidate?.length ? modelCandidate : parent.model;
	const id = crypto.randomUUID();
	const now = Date.now();
	const title = typeof body.title === 'string' ? body.title : null;

	const row = {
		id,
		title,
		agent: 'research',
		provider,
		model,
		projectPath: cfg.projectRoot,
		createdAt: now,
		lastActiveAt: now,
		lastViewedAt: now,
		parentSessionId: parentId,
		sessionType: 'research',
		totalInputTokens: null,
		totalOutputTokens: null,
		totalCachedTokens: null,
		totalCacheCreationTokens: null,
		totalReasoningTokens: null,
		totalToolTimeMs: null,
		toolCountsJson: null,
	};

	try {
		await db.insert(sessions).values(row);
		publish({ type: 'session.created', sessionId: id, payload: row });
		return c.json({ session: row, parentSessionId: parentId }, 201);
	} catch (err) {
		logger.error('Failed to create research session', err);
		const errorResponse = serializeError(err);
		return c.json(errorResponse, errorResponse.error.status || 400);
	}
}

export async function deleteResearchSession(c: Context) {
	const researchId = c.req.param('researchId');
	const projectRoot = c.req.query('project') || process.cwd();
	const { cfg, db } = await loadProjectDb(projectRoot);

	const rows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, researchId))
		.limit(1);

	if (!rows.length) return c.json({ error: 'Research session not found' }, 404);

	const session = rows[0];
	if (session.projectPath !== cfg.projectRoot) {
		return c.json({ error: 'Research session not found in this project' }, 404);
	}
	if (session.sessionType !== 'research') {
		return c.json({ error: 'Session is not a research session' }, 400);
	}

	await db.delete(sessions).where(eq(sessions.id, researchId));
	publish({
		type: 'session.deleted',
		sessionId: researchId,
		payload: { id: researchId },
	});
	return c.json({ success: true });
}

export async function injectResearchContext(c: Context) {
	const parentId = c.req.param('parentId');
	const projectRoot = c.req.query('project') || process.cwd();
	const { cfg, db } = await loadProjectDb(projectRoot);
	const body = (await c.req.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	const researchSessionId =
		typeof body.researchSessionId === 'string' ? body.researchSessionId : '';
	const label =
		typeof body.label === 'string' ? body.label : 'Research context';

	if (!researchSessionId)
		return c.json({ error: 'researchSessionId is required' }, 400);

	const [parentRows, researchRows] = await Promise.all([
		db.select().from(sessions).where(eq(sessions.id, parentId)).limit(1),
		db
			.select()
			.from(sessions)
			.where(eq(sessions.id, researchSessionId))
			.limit(1),
	]);

	if (!parentRows.length || parentRows[0].projectPath !== cfg.projectRoot) {
		return c.json({ error: 'Parent session not found' }, 404);
	}
	if (!researchRows.length || researchRows[0].sessionType !== 'research') {
		return c.json({ error: 'Research session not found' }, 404);
	}

	const contextContent = await buildResearchContext(db, researchSessionId);
	const injectedContext = `<research-context from="${researchSessionId}" label="${label}" injected-at="${new Date().toISOString()}">\n${contextContent}</research-context>`;

	return c.json({
		content: injectedContext,
		label,
		sessionId: researchSessionId,
		parentSessionId: parentId,
		tokenEstimate: Math.ceil(injectedContext.length / 4),
	});
}

export async function exportResearchSession(c: Context) {
	const researchId = c.req.param('researchId');
	const projectRoot = c.req.query('project') || process.cwd();
	const { cfg, db } = await loadProjectDb(projectRoot);
	const body = (await c.req.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;

	const researchRows = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, researchId))
		.limit(1);

	if (!researchRows.length || researchRows[0].sessionType !== 'research') {
		return c.json({ error: 'Research session not found' }, 404);
	}

	const researchSession = researchRows[0];
	if (researchSession.projectPath !== cfg.projectRoot) {
		return c.json({ error: 'Research session not in this project' }, 404);
	}

	const providerCandidate =
		typeof body.provider === 'string' ? body.provider : undefined;
	const provider: ProviderId =
		providerCandidate && hasConfiguredProvider(cfg, providerCandidate)
			? providerCandidate
			: cfg.defaults.provider;
	const modelCandidate =
		typeof body.model === 'string' ? body.model.trim() : undefined;
	const model = modelCandidate?.length ? modelCandidate : cfg.defaults.model;
	const agentCandidate =
		typeof body.agent === 'string' ? body.agent.trim() : undefined;
	const agent = agentCandidate?.length ? agentCandidate : cfg.defaults.agent;
	const contextContent = await buildResearchContext(db, researchId);
	const injectedContext = `<research-context from="${researchId}" exported-at="${new Date().toISOString()}">\n${contextContent}</research-context>`;
	const newSessionId = crypto.randomUUID();
	const now = Date.now();

	await db.insert(sessions).values({
		id: newSessionId,
		title: researchSession.title ? `From: ${researchSession.title}` : null,
		agent,
		provider,
		model,
		projectPath: cfg.projectRoot,
		createdAt: now,
		lastActiveAt: now,
		lastViewedAt: now,
		parentSessionId: null,
		sessionType: 'main',
		totalInputTokens: null,
		totalOutputTokens: null,
		totalCachedTokens: null,
		totalCacheCreationTokens: null,
		totalReasoningTokens: null,
		totalToolTimeMs: null,
		toolCountsJson: null,
	});

	const msgId = crypto.randomUUID();
	const partId = crypto.randomUUID();
	await db.insert(messages).values({
		id: msgId,
		sessionId: newSessionId,
		role: 'system',
		status: 'complete',
		agent,
		provider,
		model,
		createdAt: now,
		completedAt: now,
	});
	await db.insert(messageParts).values({
		id: partId,
		messageId: msgId,
		index: 0,
		type: 'text',
		content: injectedContext,
		agent,
		provider,
		model,
	});

	publish({
		type: 'session.created',
		sessionId: newSessionId,
		payload: { id: newSessionId },
	});
	const newSession = await db
		.select()
		.from(sessions)
		.where(eq(sessions.id, newSessionId))
		.limit(1);

	return c.json({ newSession: newSession[0], injectedContext }, 201);
}
