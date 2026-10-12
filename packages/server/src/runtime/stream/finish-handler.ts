import type { getDb } from '@ottocode/database';
import { messages, messageParts } from '@ottocode/database/schema';
import { asc, eq } from 'drizzle-orm';
import { publish, publishClientEvent } from '../../events/bus.ts';
import { estimateModelCostUsd, loadConfig } from '@ottocode/sdk';
import type { RunOpts } from '../session/queue.ts';
import { installCompactionCheckpoint } from '../message/compaction-checkpoint.ts';
import { planSessionCompaction } from '../message/compaction-mark.ts';
import { loadSessionMessages } from '../message/session-order.ts';
import { validateSummary } from '../message/summary-validation.ts';
import { publishAssistantMessageError } from '../errors/assistant-message-error.ts';
import type { FinishEvent } from './types.ts';
import {
	normalizeUsage,
	resolveUsageProvider,
} from '../session/db-operations.ts';
import { hasScopedRunningSubagentDescendant } from '../agent/runner/runner-working.ts';

type Db = Awaited<ReturnType<typeof getDb>>;

export async function markEmptyAssistantResponseAsError(args: {
	opts: RunOpts;
	db: Db;
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
		publishNotification: true,
		notificationBody: message,
	});
}

export async function installCompactCommandCheckpoint(
	opts: RunOpts,
	db: Db,
	fin: FinishEvent,
): Promise<void> {
	const assistantParts = await db
		.select()
		.from(messageParts)
		.where(eq(messageParts.messageId, opts.assistantMessageId))
		.orderBy(asc(messageParts.index));
	const summary = assistantParts
		.filter((part) => part.type === 'text')
		.map((part) => {
			try {
				const content = JSON.parse(part.content ?? '{}') as { text?: unknown };
				return typeof content.text === 'string' ? content.text : '';
			} catch {
				return '';
			}
		})
		.join('\n')
		.trim();
	const validation = validateSummary({
		text: summary,
		finishReason: fin.finishReason,
	});
	if (!validation.ok) throw new Error(validation.reason);
	if (opts.compactionContext && !opts.compactionThroughMessageId) {
		throw new Error(
			'Compaction snapshot requires an explicit evidence boundary',
		);
	}
	const sessionMessages = await loadSessionMessages(db, opts.sessionId);
	const summaryIndex = sessionMessages.findIndex(
		(message) => message.id === opts.assistantMessageId,
	);
	// Without an explicit snapshot boundary, retain intervening user/queued turns.
	const boundaryId =
		opts.compactionThroughMessageId ??
		sessionMessages
			.slice(0, summaryIndex)
			.reverse()
			.find(
				(message) =>
					message.role === 'assistant' && message.status !== 'pending',
			)?.id;
	const boundaryIndex = sessionMessages.findIndex(
		(message) => message.id === boundaryId,
	);
	if (!boundaryId || boundaryIndex < 0 || boundaryIndex >= summaryIndex) {
		throw new Error('Compaction evidence boundary is missing or invalid');
	}
	const plan = await planSessionCompaction(db, opts.sessionId, boundaryId);
	const result = installCompactionCheckpoint({
		db,
		sessionId: opts.sessionId,
		summaryMessageId: opts.assistantMessageId,
		summarizedThroughMessageId: boundaryId,
		summary,
		compactPartIds: plan.partIds,
	});
	if (!result.installed)
		throw new Error('Compaction checkpoint was not installed');
}

/**
 * Publishes the completion of an already-persisted assistant message: manual
 * compaction checkpoint, `message.completed`, session status, and (when
 * `notify` is set) the session notification.
 */
export async function publishAssistantCompletion(args: {
	opts: RunOpts;
	db: Db;
	fin: FinishEvent;
	notify?: boolean;
}): Promise<void> {
	const { opts, db, fin } = args;

	if (opts.isCompactCommand && fin.finishReason !== 'error') {
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

	if (args.notify === false) return;

	const createdAt = new Date().toISOString();
	const runStatus = fin.finishReason === 'error' ? 'failed' : 'completed';
	const status = (await hasScopedRunningSubagentDescendant(
		db,
		opts.sessionId,
		opts.projectRoot,
	))
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
}

export function createFinishHandler(
	opts: RunOpts,
	db: Db,
	completeAssistantMessageFn: (
		fin: FinishEvent,
		opts: RunOpts,
		db: Db,
	) => Promise<void>,
) {
	return async (fin: FinishEvent) => {
		if (opts.isCompactCommand)
			await installCompactCommandCheckpoint(opts, db, fin);
		await completeAssistantMessageFn(fin, opts, db);
		await publishAssistantCompletion({ opts, db, fin });
	};
}
