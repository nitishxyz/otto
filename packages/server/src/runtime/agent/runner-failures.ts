import { getDb } from '@ottocode/database';
import { messageParts, messages } from '@ottocode/database/schema';
import { loadConfig, logger } from '@ottocode/sdk';
import { eq } from 'drizzle-orm';
import { publish, publishClientEvent } from '../../events/bus.ts';
import { toErrorPayload } from '../errors/handling.ts';
import type { RunOpts } from '../session/queue.ts';

export async function markUnhandledAssistantRunFailure(
	opts: RunOpts,
	err: unknown,
) {
	const payload = toErrorPayload(err);
	const message = payload.message || 'Assistant run failed before streaming';

	try {
		const cfg = await loadConfig(opts.projectRoot);
		const db = await getDb(cfg.projectRoot);
		const existing = await db
			.select({ status: messages.status })
			.from(messages)
			.where(eq(messages.id, opts.assistantMessageId))
			.limit(1);

		if (existing[0]?.status && existing[0].status !== 'pending') {
			return;
		}

		const partId = crypto.randomUUID();
		const content = JSON.stringify({
			message,
			type: payload.type,
			details: payload.details,
			isAborted: false,
		});
		const now = Date.now();

		await db.insert(messageParts).values({
			id: partId,
			messageId: opts.assistantMessageId,
			index: 0,
			stepIndex: null,
			type: 'error',
			content,
			agent: opts.agent,
			provider: opts.provider,
			model: opts.model,
			startedAt: now,
			completedAt: now,
		});
		await db
			.update(messages)
			.set({
				status: 'error',
				completedAt: now,
				error: message,
				errorType: payload.type,
				errorDetails: JSON.stringify(payload.details ?? {}),
				finishReason: 'error',
				isAborted: false,
			})
			.where(eq(messages.id, opts.assistantMessageId));

		publish({
			type: 'message.part.delta',
			sessionId: opts.sessionId,
			payload: {
				messageId: opts.assistantMessageId,
				partId,
				type: 'error',
				content,
			},
		});
		publish({
			type: 'message.updated',
			sessionId: opts.sessionId,
			payload: {
				id: opts.assistantMessageId,
				status: 'error',
				error: message,
			},
		});
		publishClientEvent({
			type: 'session.status',
			payload: {
				sessionId: opts.sessionId,
				status: 'failed',
				messageId: opts.assistantMessageId,
				createdAt: new Date().toISOString(),
			},
		});
	} catch (failure) {
		logger.warn('[agent] failed to mark assistant run failure', {
			sessionId: opts.sessionId,
			messageId: opts.assistantMessageId,
			error:
				failure instanceof Error
					? { name: failure.name, message: failure.message }
					: { message: String(failure) },
			originalError:
				err instanceof Error
					? { name: err.name, message: err.message }
					: { message: String(err) },
		});
	}
}
