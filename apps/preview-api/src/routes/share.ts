import { Hono } from 'hono';
import { Resource } from 'sst';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../db/client';
import { sharedSessions } from '../db/schema';
import { generateShareId, generateSecret } from '../lib/nanoid';
import { sessionToMarkdown } from '../lib/markdown';
import type {
	CreateShareRequest,
	SharedSessionData,
	UpdateShareRequest,
} from '../types';

export const shareRoutes = new Hono();

const R2_PREFIX = 'sessions/';

function sessionKey(shareId: string) {
	return `${R2_PREFIX}${shareId}.json`;
}

shareRoutes.post('/', async (c) => {
	const db = createDb();
	const body = await c.req.json<CreateShareRequest>();

	const shareId = generateShareId();
	const secret = generateSecret();
	const now = Date.now();
	const expiresAt = now + (body.expiresInDays ?? 30) * 24 * 60 * 60 * 1000;

	await Resource.ShareStorage.put(
		sessionKey(shareId),
		JSON.stringify(body.sessionData),
		{ httpMetadata: { contentType: 'application/json' } },
	);

	await db.insert(sharedSessions).values({
		shareId,
		secret,
		title: body.title ?? body.sessionData.title,
		description: body.description ?? null,
		sessionData: 'r2',
		createdAt: now,
		updatedAt: now,
		expiresAt,
		viewCount: 0,
		lastSyncedMessageId: body.lastMessageId,
	});

	return c.json(
		{
			shareId,
			secret,
			url: `https://share.ottocode.io/s/${shareId}`,
			expiresAt,
		},
		201,
	);
});

shareRoutes.get('/:shareId', async (c) => {
	const db = createDb();
	const { shareId } = c.req.param();
	const format = c.req.query('format');
	const wantsMarkdown = format === 'md' || format === 'markdown';

	const session = await db.query.sharedSessions.findFirst({
		where: eq(sharedSessions.shareId, shareId),
	});

	if (!session) {
		if (wantsMarkdown) return c.text('Share not found', 404);
		return c.json({ error: 'Share not found' }, 404);
	}

	if (session.expiresAt && session.expiresAt < Date.now()) {
		if (wantsMarkdown) return c.text('Share has expired', 410);
		return c.json({ error: 'Share has expired' }, 410);
	}

	await db
		.update(sharedSessions)
		.set({ viewCount: sql`${sharedSessions.viewCount} + 1` })
		.where(eq(sharedSessions.shareId, shareId));

	const viewCount = (session.viewCount ?? 0) + 1;

	if (wantsMarkdown) {
		let sessionData: SharedSessionData;
		if (session.sessionData === 'r2') {
			const obj = await Resource.ShareStorage.get(sessionKey(shareId));
			if (!obj) {
				return c.text('Session data not found', 404);
			}
			sessionData = JSON.parse(await obj.text()) as SharedSessionData;
		} else {
			sessionData = JSON.parse(session.sessionData) as SharedSessionData;
		}
		const markdown = sessionToMarkdown(sessionData, {
			shareId: session.shareId,
			description: session.description,
		});
		return c.text(markdown, 200, {
			'Content-Type': 'text/markdown; charset=utf-8',
		});
	}

	if (session.sessionData === 'r2') {
		const obj = await Resource.ShareStorage.get(sessionKey(shareId));
		if (!obj) {
			return c.json({ error: 'Session data not found in R2' }, 404);
		}

		const prefix = JSON.stringify({
			shareId: session.shareId,
			title: session.title,
			description: session.description,
		});
		const suffix = JSON.stringify({
			createdAt: session.createdAt,
			viewCount,
			lastSyncedMessageId: session.lastSyncedMessageId,
		});

		const body = new ReadableStream({
			async start(controller) {
				const enc = new TextEncoder();
				controller.enqueue(enc.encode(`${prefix.slice(0, -1)},"sessionData":`));

				const reader = obj.body.getReader();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					controller.enqueue(value);
				}

				controller.enqueue(enc.encode(`,${suffix.slice(1)}`));
				controller.close();
			},
		});

		return new Response(body, {
			headers: { 'Content-Type': 'application/json' },
		});
	}

	return c.json({
		shareId: session.shareId,
		title: session.title,
		description: session.description,
		sessionData: JSON.parse(session.sessionData),
		createdAt: session.createdAt,
		viewCount,
		lastSyncedMessageId: session.lastSyncedMessageId,
	});
});

shareRoutes.put('/:shareId', async (c) => {
	const db = createDb();
	const { shareId } = c.req.param();
	const secret = c.req.header('X-Share-Secret');

	if (!secret) {
		return c.json({ error: 'Missing X-Share-Secret header' }, 401);
	}

	const session = await db.query.sharedSessions.findFirst({
		where: eq(sharedSessions.shareId, shareId),
	});

	if (!session) {
		return c.json({ error: 'Share not found' }, 404);
	}

	if (session.secret !== secret) {
		return c.json({ error: 'Invalid secret' }, 403);
	}

	const body = await c.req.json<UpdateShareRequest>();
	const now = Date.now();

	const updates: Partial<typeof sharedSessions.$inferInsert> = {
		updatedAt: now,
	};

	if (body.title !== undefined) {
		updates.title = body.title;
	}
	if (body.description !== undefined) {
		updates.description = body.description;
	}
	if (body.sessionData) {
		await Resource.ShareStorage.put(
			sessionKey(shareId),
			JSON.stringify(body.sessionData),
			{ httpMetadata: { contentType: 'application/json' } },
		);
		updates.sessionData = 'r2';
	}
	if (body.lastMessageId) {
		updates.lastSyncedMessageId = body.lastMessageId;
	}

	await db
		.update(sharedSessions)
		.set(updates)
		.where(eq(sharedSessions.shareId, shareId));

	await Resource.OGCache.delete(shareId);

	return c.json({
		shareId,
		url: `https://share.ottocode.io/s/${shareId}`,
		updated: true,
	});
});

shareRoutes.delete('/:shareId', async (c) => {
	const db = createDb();
	const { shareId } = c.req.param();
	const secret = c.req.header('X-Share-Secret');

	if (!secret) {
		return c.json({ error: 'Missing X-Share-Secret header' }, 401);
	}

	const session = await db.query.sharedSessions.findFirst({
		where: eq(sharedSessions.shareId, shareId),
	});

	if (!session) {
		return c.json({ error: 'Share not found' }, 404);
	}

	if (session.secret !== secret) {
		return c.json({ error: 'Invalid secret' }, 403);
	}

	await Resource.ShareStorage.delete(sessionKey(shareId));
	await db.delete(sharedSessions).where(eq(sharedSessions.shareId, shareId));

	await Resource.OGCache.delete(shareId);

	return c.body(null, 204);
});
