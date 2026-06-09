import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish, publishClientEvent } from '../../events/bus.ts';
import { estimateModelCostUsd } from '@ottocode/sdk';
import type { RunOpts } from '../session/queue.ts';
import { markSessionCompacted } from '../message/compaction.ts';
import type { FinishEvent } from './types.ts';
import {
	normalizeUsage,
	resolveUsageProvider,
} from '../session/db-operations.ts';

export function createFinishHandler(
	opts: RunOpts,
	db: Awaited<ReturnType<typeof getDb>>,
	completeAssistantMessageFn: (
		fin: FinishEvent,
		opts: RunOpts,
		db: Awaited<ReturnType<typeof getDb>>,
	) => Promise<void>,
) {
	return async (fin: FinishEvent) => {
		try {
			await completeAssistantMessageFn(fin, opts, db);
		} catch {}

		if (opts.isCompactCommand && fin.finishReason !== 'error') {
			const assistantParts = await db
				.select()
				.from(messageParts)
				.where(eq(messageParts.messageId, opts.assistantMessageId));
			const hasTextContent = assistantParts.some(
				(p) => p.type === 'text' && p.content && p.content !== '{"text":""}',
			);

			if (!hasTextContent) {
			} else {
				try {
					const result = await markSessionCompacted(
						db,
						opts.sessionId,
						opts.assistantMessageId,
					);
					void result;
				} catch {}
			}
		}

		const sessRows = await db
			.select()
			.from(messages)
			.where(eq(messages.id, opts.assistantMessageId));

		const usage = sessRows[0]
			? {
					inputTokens: Number(sessRows[0].inputTokens ?? 0),
					outputTokens: Number(sessRows[0].outputTokens ?? 0),
					totalTokens: Number(sessRows[0].totalTokens ?? 0),
					cachedInputTokens: Number(sessRows[0].cachedInputTokens ?? 0),
					cacheCreationInputTokens: Number(
						sessRows[0].cacheCreationInputTokens ?? 0,
					),
				}
			: fin.usage
				? normalizeUsage(
						fin.usage,
						undefined,
						resolveUsageProvider(opts.provider, opts.model),
					)
				: undefined;

		const costUsd = usage
			? estimateModelCostUsd(opts.provider, opts.model, usage)
			: undefined;

		publish({
			type: 'message.completed',
			sessionId: opts.sessionId,
			payload: {
				id: opts.assistantMessageId,
				usage,
				costUsd,
				finishReason: fin.finishReason,
				rawFinishReason: fin.rawFinishReason,
			},
		});

		const createdAt = new Date().toISOString();
		const status = fin.finishReason === 'error' ? 'failed' : 'completed';
		publishClientEvent({
			type: 'session.status',
			payload: {
				sessionId: opts.sessionId,
				status,
				messageId: opts.assistantMessageId,
				createdAt,
			},
		});
		publishClientEvent({
			type: 'notification',
			payload: {
				id: crypto.randomUUID(),
				level: status === 'failed' ? 'error' : 'success',
				title: status === 'failed' ? 'Session failed' : 'Session completed',
				body:
					status === 'failed'
						? 'An assistant run ended with an error.'
						: 'An assistant run finished successfully.',
				source: 'session',
				sessionId: opts.sessionId,
				createdAt,
			},
		});
	};
}
