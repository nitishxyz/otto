import type { DB } from '@ottocode/database';
import { messageParts, messages } from '@ottocode/database/schema';
import { desc, eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';

export async function insertTextMessage(args: {
	db: DB;
	sessionId: string;
	role: 'system' | 'user' | 'assistant';
	status?: 'complete' | 'pending' | 'error';
	agent: string;
	provider: string;
	model: string;
	text: string;
	createdAt?: number;
}): Promise<string> {
	const {
		db,
		sessionId,
		role,
		status = 'complete',
		agent,
		provider,
		model,
		text,
		createdAt = Date.now(),
	} = args;
	const messageId = crypto.randomUUID();
	await db.insert(messages).values({
		id: messageId,
		sessionId,
		role,
		status,
		agent,
		provider,
		model,
		createdAt,
		completedAt: status === 'pending' ? null : createdAt,
	});
	await db.insert(messageParts).values({
		id: crypto.randomUUID(),
		messageId,
		index: 0,
		type: 'text',
		content: JSON.stringify({ text }),
		agent,
		provider,
		model,
		startedAt: createdAt,
		completedAt: status === 'pending' ? null : createdAt,
	});
	publish({
		type: 'message.created',
		sessionId,
		payload: { id: messageId, role, agent, provider, model, content: text },
	});
	if (status !== 'pending') {
		publish({
			type: 'message.completed',
			sessionId,
			payload: { id: messageId, status },
		});
	}
	return messageId;
}

export async function getLatestMessageId(
	db: DB,
	sessionId: string,
): Promise<string | null> {
	const rows = await db
		.select({ id: messages.id })
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(desc(messages.createdAt))
		.limit(1);
	return rows[0]?.id ?? null;
}
