import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish, publishClientEvent } from '../../events/bus.ts';
import { estimateModelCostUsd, loadConfig } from '@ottocode/sdk';
import type { RunOpts } from '../session/queue.ts';
import {
	markSessionCompacted,
	saveCompactionCheckpoint,
} from '../message/compaction.ts';
import { publishAssistantMessageError } from '../errors/assistant-message-error.ts';
import type { FinishEvent } from './types.ts';
import {
	normalizeUsage,
	resolveUsageProvider,
} from '../session/db-operations.ts';
import { hasRunningSubagentDescendant } from '../session/working.ts';

export async function markEmptyAssistantResponseAsError(args: {
	opts: RunOpts;
	db: Awaited<ReturnType<typeof getDb>>;
	fin: FinishEvent;
}) {
	const { opts, db, fin } = args;
	const message = 'Assistant response finished without returning any content.';
	const details = {
		finishReason: fin.finishReason,
		rawFinishReason: fin.rawFinishReason,
		provider: opts.provider,
		model: opts.model,
	};
	await publishAssistantMessageError({
		db,
		opts,
		error: {
			message,
			type: 'empty_response',
			details,
			isAborted: false,
		},
		partIndex: 0,
		publishNotification: true,
		notificationBody: message,
	});
}

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

		const assistantParts = await db
			.select()
			.from(messageParts)
			.where(eq(messageParts.messageId, opts.assistantMessageId));

		let compactionCompleted = false;
		if (opts.isCompactCommand && fin.finishReason !== 'error') {
			const hasTextContent = assistantParts.some(
				(p) => p.type === 'text' && p.content && p.content !== '{"text":""}',
			);

			if (!hasTextContent) {
			} else {
				try {
					const summary = assistantParts
						.filter((part) => part.type === 'text')
						.map((part) => {
							try {
								const content = JSON.parse(part.content ?? '{}') as {
									text?: unknown;
								};
								return typeof content.text === 'string' ? content.text : '';
							} catch {
								return '';
							}
						})
						.join('\n')
						.trim();
					const result = await markSessionCompacted(
						db,
						opts.sessionId,
						opts.assistantMessageId,
					);
					void result;
					await saveCompactionCheckpoint({
						db,
						sessionId: opts.sessionId,
						compactionMessageId: opts.assistantMessageId,
						summary,
					});
					compactionCompleted = true;
				} catch {}
			}
		}
		if (compactionCompleted) {
			try {
				const { reportSubagentCompactionComplete } = await import(
					'../subagents/service.ts'
				);
				const cfg = await loadConfig(opts.projectRoot);
				await reportSubagentCompactionComplete(db, cfg, opts.sessionId);
			} catch {}
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
			projectId: opts.projectId,
			projectRoot: opts.projectRoot,
			payload: {
				id: opts.assistantMessageId,
				usage,
				costUsd,
				finishReason: fin.finishReason,
				rawFinishReason: fin.rawFinishReason,
			},
		});

		const createdAt = new Date().toISOString();
		const runStatus = fin.finishReason === 'error' ? 'failed' : 'completed';
		const status = (await hasRunningSubagentDescendant(db, opts.sessionId))
			? 'running'
			: runStatus;
		publishClientEvent({
			type: 'session.status',
			payload: {
				sessionId: opts.sessionId,
				projectId: opts.projectId,
				projectRoot: opts.projectRoot,
				status,
				messageId: opts.assistantMessageId,
				createdAt,
			},
		});
		publishClientEvent({
			type: 'notification',
			payload: {
				id: crypto.randomUUID(),
				level: runStatus === 'failed' ? 'error' : 'success',
				title: runStatus === 'failed' ? 'Session failed' : 'Session completed',
				body:
					runStatus === 'failed'
						? 'An assistant run ended with an error.'
						: 'An assistant run finished successfully.',
				source: 'session',
				sessionId: opts.sessionId,
				projectId: opts.projectId,
				projectRoot: opts.projectRoot,
				createdAt,
			},
		});
	};
}
