import { messageParts, messages } from '@ottocode/database/schema';
import { logger, type ProviderId } from '@ottocode/sdk';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { publish } from '../../../events/bus.ts';
import { runSessionLoop } from '../../../runtime/agent/runner.ts';
import {
	abortMessage,
	enqueueAssistantRun,
	getQueueState,
	removeFromQueue,
	sendQueuedMessageNow,
} from '../../../runtime/session/queue.ts';
import { findSessionById } from './core.ts';
import type { ProjectDbContext } from './types.ts';

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
		.where(and(eq(messages.id, messageId), eq(messages.sessionId, sessionId)))
		.limit(1);

	if (assistantMsg.length === 0) return;

	const sessionMessages = await db
		.select()
		.from(messages)
		.where(eq(messages.sessionId, sessionId))
		.orderBy(asc(messages.createdAt));
	const assistantIndex = sessionMessages.findIndex(
		(message) => message.id === messageId,
	);
	const userMsg =
		assistantIndex > 0
			? sessionMessages
					.slice(0, assistantIndex)
					.reverse()
					.find((message) => message.role === 'user')
			: undefined;

	const messageIdsToDelete = [messageId];
	if (userMsg) {
		messageIdsToDelete.push(userMsg.id);
	}

	await db
		.delete(messageParts)
		.where(inArray(messageParts.messageId, messageIdsToDelete));
	await db.delete(messages).where(inArray(messages.id, messageIdsToDelete));
}

/** Promotes a queued assistant message and silently preempts the active run. */
export function sendSessionQueuedMessageNow(
	sessionId: string,
	messageId: string,
):
	| {
			body: {
				success: true;
				promoted: boolean;
				wasQueued: boolean;
				wasRunning: boolean;
				preemptedMessageId: string | null;
			};
			status?: never;
	  }
	| { body: { success: false; promoted: false }; status: 404 } {
	const result = sendQueuedMessageNow(sessionId, messageId, runSessionLoop);
	if (!result.success) {
		return { body: { success: false, promoted: false }, status: 404 };
	}

	return { body: result };
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
