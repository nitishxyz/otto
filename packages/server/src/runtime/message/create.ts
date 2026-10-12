import { messages, messageParts } from '@ottocode/database/schema';
import { publish } from '../../events/bus.ts';
import {
	buildMessageContextRows,
	registerPreparedContextMetrics,
	type PreparedMessageContext,
} from './context.ts';
import type { AcceptedTurnIds, DispatchOptions, TurnClaim } from './types.ts';

type MessageInsert = typeof messages.$inferInsert;
type PartInsert = typeof messageParts.$inferInsert;

type UserMessageInput = {
	sessionId: string;
	agent: string;
	provider: DispatchOptions['provider'];
	model: string;
	content: string;
	messageOrigin?: DispatchOptions['messageOrigin'];
	createdAt: number;
	preloadedFileMentions?: string[];
	/** Model-visible text with mentioned files inlined, captured at dispatch. */
	mentionSnapshotText?: string;
	images?: DispatchOptions['images'];
	files?: DispatchOptions['files'];
};

type PreparedRows = {
	message: MessageInsert;
	parts: PartInsert[];
	publish: () => void;
};

function prepareUserMessage(args: UserMessageInput): PreparedRows & {
	userMessageId: string;
} {
	const userMessageId = crypto.randomUUID();
	const base = {
		messageId: userMessageId,
		agent: args.agent,
		provider: args.provider,
		model: args.model,
	};
	const parts: PartInsert[] = [
		{
			...base,
			id: crypto.randomUUID(),
			index: 0,
			type: 'text',
			content: JSON.stringify({
				text: String(args.content),
				messageOrigin: args.messageOrigin ?? 'human',
				preloadedFileMentions: args.preloadedFileMentions,
				mentionSnapshot:
					args.mentionSnapshotText !== undefined &&
					args.mentionSnapshotText !== String(args.content)
						? { text: args.mentionSnapshotText }
						: undefined,
			}),
		},
	];
	for (const [i, img] of (args.images ?? []).entries()) {
		parts.push({
			...base,
			id: crypto.randomUUID(),
			index: i + 1,
			type: 'image',
			content: JSON.stringify({
				data: img.data,
				mediaType: img.mediaType,
				name: img.name,
				attachmentId: img.attachmentId,
				original: img.original,
				compression: img.compression,
			}),
		});
	}
	let nextIndex = (args.images?.length ?? 0) + 1;
	for (const file of args.files ?? []) {
		parts.push({
			...base,
			id: crypto.randomUUID(),
			index: nextIndex++,
			type: file.type === 'image' ? 'image' : 'file',
			content: JSON.stringify({
				type: file.type,
				name: file.name,
				data: file.data,
				mediaType: file.mediaType,
				compression: file.compression,
				textContent: file.textContent,
				attachmentId: file.attachmentId,
				original: file.original,
			}),
		});
	}
	return {
		userMessageId,
		message: {
			id: userMessageId,
			sessionId: args.sessionId,
			role: 'user',
			status: 'complete',
			agent: args.agent,
			provider: args.provider,
			model: args.model,
			createdAt: args.createdAt,
		},
		parts,
		publish: () =>
			publish({
				type: 'message.created',
				sessionId: args.sessionId,
				payload: {
					id: userMessageId,
					sessionId: args.sessionId,
					role: 'user',
					status: 'complete',
					agent: args.agent,
					provider: args.provider,
					model: args.model,
					createdAt: args.createdAt,
					completedAt: args.createdAt,
					content: String(args.content),
					attachmentNames: [
						...(args.images ?? []).map((image) => image.name || 'image'),
						...(args.files ?? []).map((file) => file.name),
					],
				},
			}),
	};
}

function preparePendingAssistant(args: {
	sessionId: string;
	agent: string;
	provider: DispatchOptions['provider'];
	model: string;
}): PreparedRows & { assistantMessageId: string } {
	const assistantMessageId = crypto.randomUUID();
	const createdAt = Date.now();
	return {
		assistantMessageId,
		message: {
			id: assistantMessageId,
			sessionId: args.sessionId,
			role: 'assistant',
			status: 'pending',
			agent: args.agent,
			provider: args.provider,
			model: args.model,
			createdAt,
		},
		parts: [],
		publish: () =>
			publish({
				type: 'message.created',
				sessionId: args.sessionId,
				payload: {
					id: assistantMessageId,
					sessionId: args.sessionId,
					role: 'assistant',
					status: 'pending',
					agent: args.agent,
					provider: args.provider,
					model: args.model,
					createdAt,
				},
			}),
	};
}

function insertPrepared(
	db: DispatchOptions['db'],
	rows: PreparedRows[],
	claim?: { run: TurnClaim; ids: AcceptedTurnIds },
): void {
	db.transaction((tx) => {
		for (const row of rows) {
			tx.insert(messages).values(row.message).run();
			if (row.parts.length > 0) {
				tx.insert(messageParts).values(row.parts).run();
			}
		}
		claim?.run(tx, claim.ids);
	});
}

export async function createUserMessage(
	args: UserMessageInput & { db: DispatchOptions['db'] },
): Promise<{ userMessageId: string }> {
	const prepared = prepareUserMessage(args);
	insertPrepared(args.db, [prepared]);
	prepared.publish();
	return { userMessageId: prepared.userMessageId };
}

export async function createPendingAssistantMessage(args: {
	db: DispatchOptions['db'];
	sessionId: string;
	agent: string;
	provider: DispatchOptions['provider'];
	model: string;
}): Promise<{ assistantMessageId: string }> {
	const prepared = preparePendingAssistant(args);
	insertPrepared(args.db, [prepared]);
	prepared.publish();
	return { assistantMessageId: prepared.assistantMessageId };
}

/**
 * Accepts a user turn atomically: the user message and its parts, the pending
 * assistant message, synthetic context read pairs, and the optional `claim`
 * commit in one transaction. If `claim` throws, nothing is persisted and the
 * error propagates. Events and metrics are published only after commit.
 */
export async function acceptUserTurn(
	args: UserMessageInput & {
		db: DispatchOptions['db'];
		context?: PreparedMessageContext;
		claim?: TurnClaim;
	},
): Promise<{
	userMessageId: string;
	assistantMessageId: string;
	contextTokens: number;
}> {
	const user = prepareUserMessage(args);
	const assistant = preparePendingAssistant(args);
	const contextRows = buildMessageContextRows({
		messageId: assistant.assistantMessageId,
		agent: args.agent,
		provider: args.provider,
		model: args.model,
		prepared: args.context,
	});
	insertPrepared(
		args.db,
		[user, { ...assistant, parts: contextRows }],
		args.claim
			? {
					run: args.claim,
					ids: {
						userMessageId: user.userMessageId,
						assistantMessageId: assistant.assistantMessageId,
					},
				}
			: undefined,
	);
	user.publish();
	assistant.publish();
	const contextTokens = registerPreparedContextMetrics({
		sessionId: args.sessionId,
		messageId: assistant.assistantMessageId,
		prepared: args.context,
	});
	return {
		userMessageId: user.userMessageId,
		assistantMessageId: assistant.assistantMessageId,
		contextTokens,
	};
}
