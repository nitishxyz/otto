import type { getDb } from '@ottocode/database';
import { messageParts, messages } from '@ottocode/database/schema';
import { and, desc, eq } from 'drizzle-orm';
import { publish, publishClientEvent } from '../../events/bus.ts';
import type { RunOpts } from '../session/queue.ts';
import { hasScopedRunningSubagentDescendant } from '../agent/runner/runner-working.ts';

export type AssistantMessageErrorInput = {
	message: string;
	type: string;
	details?: unknown;
	isAborted?: boolean;
	finishReason?: string;
};

export async function publishAssistantMessageError(args: {
	db: Awaited<ReturnType<typeof getDb>>;
	opts: RunOpts;
	error: AssistantMessageErrorInput;
	partId?: string;
	partIndex?: number;
	stepIndex?: number;
	nextPartIndex?: () => number | Promise<number>;
	publishErrorEvent?: boolean;
	publishNotification?: boolean;
	notificationBody?: string;
}): Promise<{ partId: string; content: string; persisted: boolean }> {
	const partId = args.partId ?? crypto.randomUUID();
	const isAborted = args.error.isAborted === true;
	const content = JSON.stringify({
		message: args.error.message,
		type: args.error.type,
		details: args.error.details,
		isAborted,
	});
	const now = Date.now();
	const requestedIndex =
		args.partIndex ??
		(args.nextPartIndex ? await args.nextPartIndex() : undefined);
	const persisted = args.db.transaction((tx) => {
		const claimed = tx
			.update(messages)
			.set({
				status: 'error',
				completedAt: now,
				error: args.error.message,
				errorType: args.error.type,
				errorDetails: JSON.stringify(args.error.details ?? {}),
				finishReason: args.error.finishReason ?? 'error',
				isAborted,
			})
			.where(
				and(
					eq(messages.id, args.opts.assistantMessageId),
					eq(messages.status, 'pending'),
				),
			)
			.returning({ id: messages.id })
			.all();
		if (!claimed.length) return false;
		const last = tx
			.select({ index: messageParts.index })
			.from(messageParts)
			.where(eq(messageParts.messageId, args.opts.assistantMessageId))
			.orderBy(desc(messageParts.index))
			.limit(1)
			.all();
		tx.insert(messageParts)
			.values({
				id: partId,
				messageId: args.opts.assistantMessageId,
				index: Math.max(requestedIndex ?? 0, (last[0]?.index ?? -1) + 1),
				stepIndex: args.stepIndex ?? null,
				type: 'error',
				content,
				agent: args.opts.agent,
				provider: args.opts.provider,
				model: args.opts.model,
				startedAt: now,
				completedAt: now,
			})
			.run();
		return true;
	});
	if (!persisted) return { partId, content, persisted };

	if (args.publishErrorEvent !== false) {
		publish({
			type: 'error',
			sessionId: args.opts.sessionId,
			projectId: args.opts.projectId,
			projectRoot: args.opts.projectRoot,
			payload: {
				messageId: args.opts.assistantMessageId,
				partId,
				message: args.error.message,
				error: args.error.message,
				type: args.error.type,
				errorType: args.error.type,
				details: args.error.details,
				isAborted,
			},
		});
	}

	publish({
		type: 'message.part.delta',
		sessionId: args.opts.sessionId,
		projectId: args.opts.projectId,
		projectRoot: args.opts.projectRoot,
		payload: {
			messageId: args.opts.assistantMessageId,
			partId,
			type: 'error',
			content,
		},
	});

	publish({
		type: 'message.updated',
		sessionId: args.opts.sessionId,
		projectId: args.opts.projectId,
		projectRoot: args.opts.projectRoot,
		payload: {
			id: args.opts.assistantMessageId,
			status: 'error',
			error: args.error.message,
		},
	});

	const createdAt = new Date().toISOString();
	const status = (await hasScopedRunningSubagentDescendant(
		args.db,
		args.opts.sessionId,
		args.opts.projectRoot,
	))
		? 'running'
		: 'failed';
	publishClientEvent({
		type: 'session.status',
		payload: {
			sessionId: args.opts.sessionId,
			projectId: args.opts.projectId,
			projectRoot: args.opts.projectRoot,
			status,
			messageId: args.opts.assistantMessageId,
			createdAt,
		},
	});

	if (args.publishNotification) {
		publishClientEvent({
			type: 'notification',
			payload: {
				id: crypto.randomUUID(),
				level: 'error',
				title: 'Session failed',
				body: args.notificationBody ?? args.error.message,
				source: 'session',
				sessionId: args.opts.sessionId,
				projectId: args.opts.projectId,
				projectRoot: args.opts.projectRoot,
				createdAt,
			},
		});
	}

	return { partId, content, persisted };
}
