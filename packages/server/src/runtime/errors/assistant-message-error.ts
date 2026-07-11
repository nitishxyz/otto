import type { getDb } from '@ottocode/database';
import { messageParts, messages } from '@ottocode/database/schema';
import { eq } from 'drizzle-orm';
import { publish, publishClientEvent } from '../../events/bus.ts';
import type { RunOpts } from '../session/queue.ts';
import { hasRunningSubagentDescendant } from '../session/working.ts';

export type AssistantMessageErrorInput = {
	message: string;
	type: string;
	details?: unknown;
	isAborted?: boolean;
};

export async function publishAssistantMessageError(args: {
	db: Awaited<ReturnType<typeof getDb>>;
	opts: RunOpts;
	error: AssistantMessageErrorInput;
	partId?: string;
	partIndex?: number;
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
	let persisted = true;

	try {
		await args.db.insert(messageParts).values({
			id: partId,
			messageId: args.opts.assistantMessageId,
			index:
				args.partIndex ?? (args.nextPartIndex ? await args.nextPartIndex() : 0),
			stepIndex: null,
			type: 'error',
			content,
			agent: args.opts.agent,
			provider: args.opts.provider,
			model: args.opts.model,
			startedAt: now,
			completedAt: now,
		});
		await args.db
			.update(messages)
			.set({
				status: 'error',
				completedAt: now,
				error: args.error.message,
				errorType: args.error.type,
				errorDetails: JSON.stringify(args.error.details ?? {}),
				finishReason: 'error',
				isAborted,
			})
			.where(eq(messages.id, args.opts.assistantMessageId));
	} catch {
		persisted = false;
	}

	if (args.publishErrorEvent !== false) {
		publish({
			type: 'error',
			sessionId: args.opts.sessionId,
			payload: {
				messageId: args.opts.assistantMessageId,
				message: args.error.message,
				type: args.error.type,
				details: args.error.details,
				isAborted,
			},
		});
	}

	publish({
		type: 'message.part.delta',
		sessionId: args.opts.sessionId,
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
		payload: {
			id: args.opts.assistantMessageId,
			status: 'error',
			error: args.error.message,
		},
	});

	const createdAt = new Date().toISOString();
	const status = (await hasRunningSubagentDescendant(
		args.db,
		args.opts.sessionId,
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
