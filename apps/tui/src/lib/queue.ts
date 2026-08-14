import { extractPartText } from './message-blocks.ts';
import type { Message } from '../types.ts';

export interface QueuedMessageItem {
	assistantMessageId: string;
	userMessageId: string;
	summary: string;
	content: string;
}

export interface OptimisticQueuedMessage {
	clientId: string;
	assistantMessageId: string | null;
	summary: string;
	content: string;
	confirmed: boolean;
}

export function getQueuedMessageSummary(
	content: string,
	attachmentNames: string[] = [],
): string {
	const text = content.replace(/\s+/g, ' ').trim();
	const attachmentLabel =
		attachmentNames.length === 1
			? `◳ ${attachmentNames[0]}`
			: attachmentNames.length > 1
				? `◳ ${attachmentNames.length} attachments`
				: '';
	return [attachmentLabel, text].filter(Boolean).join(' · ') || 'Message';
}

function getMessageText(message: Message): string {
	const parts = [...(message.parts ?? [])].sort(
		(a, b) => (a.index ?? 0) - (b.index ?? 0),
	);
	return parts
		.filter((part) => part.type === 'text')
		.map(extractPartText)
		.join('\n')
		.trim();
}

function getMessageSummary(message: Message): string {
	const parts = [...(message.parts ?? [])].sort(
		(a, b) => (a.index ?? 0) - (b.index ?? 0),
	);
	const text = getMessageText(message).replace(/\s+/g, ' ').trim();
	const attachmentCount =
		message.attachmentNames?.length ??
		parts.filter((part) => part.type === 'image' || part.type === 'file')
			.length;
	const attachmentNames =
		message.attachmentNames ??
		Array.from(
			{ length: attachmentCount },
			(_, index) => `attachment ${index + 1}`,
		);
	return getQueuedMessageSummary(text, attachmentNames);
}

/** Maps queue order to the user messages displayed by the queue modal. */
export function getQueuedMessageItems(
	messages: Message[],
	queuedAssistantMessageIds: Set<string>,
): QueuedMessageItem[] {
	const sorted = messages
		.filter(
			(message) => message.role === 'user' || message.role === 'assistant',
		)
		.sort((a, b) => a.createdAt - b.createdAt);
	const indexes = new Map(sorted.map((message, index) => [message.id, index]));
	const usedUserMessageIds = new Set<string>();
	const itemsByAssistantId = new Map<string, QueuedMessageItem>();
	const findPreviousUser = (assistantIndex: number): Message | undefined => {
		for (let index = assistantIndex - 1; index >= 0; index--) {
			if (sorted[index].role === 'user') return sorted[index];
		}
		return undefined;
	};

	for (let index = 0; index < sorted.length; index++) {
		const message = sorted[index];
		if (
			message.role !== 'assistant' ||
			queuedAssistantMessageIds.has(message.id)
		) {
			continue;
		}
		const userMessage = findPreviousUser(index);
		if (userMessage) usedUserMessageIds.add(userMessage.id);
	}

	for (const assistantMessageId of queuedAssistantMessageIds) {
		const assistantIndex = indexes.get(assistantMessageId);
		if (assistantIndex === undefined) continue;
		const userMessage = findPreviousUser(assistantIndex);
		if (!userMessage || usedUserMessageIds.has(userMessage.id)) continue;
		usedUserMessageIds.add(userMessage.id);
		itemsByAssistantId.set(assistantMessageId, {
			assistantMessageId,
			userMessageId: userMessage.id,
			summary: getMessageSummary(userMessage),
			content: getMessageText(userMessage),
		});
	}

	const unresolvedIds = [...queuedAssistantMessageIds].filter(
		(assistantMessageId) => !itemsByAssistantId.has(assistantMessageId),
	);
	const fallbackUsers = sorted
		.filter(
			(message) =>
				message.role === 'user' && !usedUserMessageIds.has(message.id),
		)
		.slice(-unresolvedIds.length);
	for (let index = 0; index < unresolvedIds.length; index++) {
		const userMessage = fallbackUsers[index];
		if (!userMessage) continue;
		const assistantMessageId = unresolvedIds[index];
		itemsByAssistantId.set(assistantMessageId, {
			assistantMessageId,
			userMessageId: userMessage.id,
			summary: getMessageSummary(userMessage),
			content: getMessageText(userMessage),
		});
	}

	return [...queuedAssistantMessageIds].flatMap((assistantMessageId) => {
		const item = itemsByAssistantId.get(assistantMessageId);
		return item ? [item] : [];
	});
}
