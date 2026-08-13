import { messages, messageParts } from '@ottocode/database/schema';
import { publish } from '../../events/bus.ts';
import type { DispatchOptions } from './types.ts';

export async function createUserMessage(args: {
	db: DispatchOptions['db'];
	sessionId: string;
	agent: string;
	provider: DispatchOptions['provider'];
	model: string;
	content: string;
	createdAt: number;
	images?: DispatchOptions['images'];
	files?: DispatchOptions['files'];
}): Promise<{ userMessageId: string }> {
	const userMessageId = crypto.randomUUID();
	await args.db.insert(messages).values({
		id: userMessageId,
		sessionId: args.sessionId,
		role: 'user',
		status: 'complete',
		agent: args.agent,
		provider: args.provider,
		model: args.model,
		createdAt: args.createdAt,
	});
	await args.db.insert(messageParts).values({
		id: crypto.randomUUID(),
		messageId: userMessageId,
		index: 0,
		type: 'text',
		content: JSON.stringify({ text: String(args.content) }),
		agent: args.agent,
		provider: args.provider,
		model: args.model,
	});

	if (args.images && args.images.length > 0) {
		for (let i = 0; i < args.images.length; i++) {
			const img = args.images[i];
			await args.db.insert(messageParts).values({
				id: crypto.randomUUID(),
				messageId: userMessageId,
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
				agent: args.agent,
				provider: args.provider,
				model: args.model,
			});
		}
	}

	let nextIndex = (args.images?.length ?? 0) + 1;
	if (args.files && args.files.length > 0) {
		for (const file of args.files) {
			const partType = file.type === 'image' ? 'image' : 'file';
			await args.db.insert(messageParts).values({
				id: crypto.randomUUID(),
				messageId: userMessageId,
				index: nextIndex++,
				type: partType,
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
				agent: args.agent,
				provider: args.provider,
				model: args.model,
			});
		}
	}

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
	});

	return { userMessageId };
}

export async function createPendingAssistantMessage(args: {
	db: DispatchOptions['db'];
	sessionId: string;
	agent: string;
	provider: DispatchOptions['provider'];
	model: string;
}): Promise<{ assistantMessageId: string }> {
	const assistantMessageId = crypto.randomUUID();
	const createdAt = Date.now();
	await args.db.insert(messages).values({
		id: assistantMessageId,
		sessionId: args.sessionId,
		role: 'assistant',
		status: 'pending',
		agent: args.agent,
		provider: args.provider,
		model: args.model,
		createdAt,
	});
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
	});

	return { assistantMessageId };
}
