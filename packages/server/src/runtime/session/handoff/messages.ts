import type { DB } from '@ottocode/database';
import { messageParts, messages } from '@ottocode/database/schema';
import { desc, eq } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';

type TextMessageInput = {
	sessionId: string;
	role: 'system' | 'user' | 'assistant';
	status?: 'complete' | 'pending' | 'error';
	agent: string;
	provider: string;
	model: string;
	text: string;
	createdAt?: number;
};

export type PreparedTextMessage = {
	id: string;
	message: typeof messages.$inferInsert;
	part: typeof messageParts.$inferInsert;
	/** Publishes message events; call only after the rows are committed. */
	publish: () => void;
};

/** Builds rows for a one-part text message without writing them. */
export function prepareTextMessage(
	args: TextMessageInput,
): PreparedTextMessage {
	const {
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
	return {
		id: messageId,
		message: {
			id: messageId,
			sessionId,
			role,
			status,
			agent,
			provider,
			model,
			createdAt,
			completedAt: status === 'pending' ? null : createdAt,
		},
		part: {
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
		},
		publish: () => {
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
		},
	};
}

export async function insertTextMessage(
	args: TextMessageInput & { db: DB },
): Promise<string> {
	const prepared = prepareTextMessage(args);
	args.db.transaction((tx) => {
		tx.insert(messages).values(prepared.message).run();
		tx.insert(messageParts).values(prepared.part).run();
	});
	prepared.publish();
	return prepared.id;
}

export async function getLatestMessageId(
	db: DB,
	sessionId: string,
): Promise<string | null> {
	const rows = await db
		.select({ id: messages.id })
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(desc(messages.sequence), desc(messages.createdAt))
		.limit(1);
	return rows[0]?.id ?? null;
}
