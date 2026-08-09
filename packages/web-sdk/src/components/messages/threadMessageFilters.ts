import type { Message, MessagePart } from '../../types/api';
import type { TodoItem, TodoSnapshot } from '../../stores/todoStore';

const TODO_TOOL_NAMES = new Set([
	'update_todos',
	'update_plan',
	'UpdateTodos',
	'UpdatePlan',
]);

export const TODO_SNAPSHOT_SCAN_MESSAGE_LIMIT = 12;
const TODO_SNAPSHOT_SCAN_PART_LIMIT = 500;

function parseToolResultContent(
	part: MessagePart,
): Record<string, unknown> | null {
	if (part.contentJson && typeof part.contentJson === 'object') {
		return part.contentJson;
	}
	try {
		const parsed = JSON.parse(part.content);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {}
	return null;
}

function isTodoStatus(status: unknown): status is TodoItem['status'] {
	return (
		status === 'pending' ||
		status === 'in_progress' ||
		status === 'completed' ||
		status === 'cancelled'
	);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeTodoItems(rawItems: unknown): TodoItem[] | null {
	if (!Array.isArray(rawItems)) return null;
	const items = rawItems.flatMap((item): TodoItem[] => {
		if (typeof item === 'string') {
			const step = item.trim();
			return step ? [{ step, status: 'pending' }] : [];
		}
		const record = asRecord(item);
		if (!record) return [];
		const rawStep =
			typeof record.step === 'string'
				? record.step
				: typeof record.description === 'string'
					? record.description
					: '';
		const step = rawStep.trim();
		if (!step) return [];
		return [
			{
				step,
				status: isTodoStatus(record.status) ? record.status : 'pending',
			},
		];
	});
	return items.length > 0 ? items : null;
}

function getTodoToolName(
	part: MessagePart,
	content: Record<string, unknown> | null,
) {
	const name = part.toolName ?? content?.name;
	return typeof name === 'string' ? name : null;
}

function parseTodoSnapshot(
	content: Record<string, unknown>,
): Omit<TodoSnapshot, 'updatedAt'> | null {
	const result = asRecord(content.result) ?? content;
	const args = asRecord(content.args);
	const sources = [
		{ rawItems: result.items, note: result.note },
		{ rawItems: content.items, note: content.note },
		{ rawItems: args?.todos, note: args?.note },
	];

	for (const source of sources) {
		const items = normalizeTodoItems(source.rawItems);
		if (items) {
			return {
				items,
				note: typeof source.note === 'string' ? source.note : undefined,
			};
		}
	}

	return null;
}

function isTodoSnapshotDone(snapshot: Omit<TodoSnapshot, 'updatedAt'>) {
	return (
		snapshot.items.length > 0 &&
		snapshot.items.every(
			(item) => item.status === 'completed' || item.status === 'cancelled',
		)
	);
}

function isQueuedUserMessage(
	messages: Message[],
	messageIndex: number,
	queuedMessageIds: Set<string>,
) {
	const nextAssistant = messages
		.slice(messageIndex + 1)
		.find((message) => message.role === 'assistant');
	return Boolean(nextAssistant && queuedMessageIds.has(nextAssistant.id));
}

export function findLatestTodoSnapshot(
	messages: Message[],
	queuedMessageIds: Set<string>,
): Omit<TodoSnapshot, 'updatedAt'> | null {
	let hasNewerUserMessage = false;

	for (
		let messageIndex = messages.length - 1;
		messageIndex >= 0;
		messageIndex--
	) {
		const message = messages[messageIndex];
		if (
			message?.role === 'user' &&
			!isQueuedUserMessage(messages, messageIndex, queuedMessageIds)
		) {
			hasNewerUserMessage = true;
		}

		const parts = message?.parts ?? [];
		const firstPartIndex = Math.max(
			0,
			parts.length - TODO_SNAPSHOT_SCAN_PART_LIMIT,
		);
		for (
			let partIndex = parts.length - 1;
			partIndex >= firstPartIndex;
			partIndex--
		) {
			const part = parts[partIndex];
			if (part.type !== 'tool_result') continue;
			const content = parseToolResultContent(part);
			const toolName = getTodoToolName(part, content);
			if (!toolName || !TODO_TOOL_NAMES.has(toolName)) continue;
			if (!content) return null;
			const snapshot = parseTodoSnapshot(content);
			if (!snapshot) return null;
			if (hasNewerUserMessage && isTodoSnapshotDone(snapshot)) return null;
			return snapshot;
		}
	}
	return null;
}

export function getTodoSnapshotScanWindow(messages: Message[]) {
	if (messages.length <= TODO_SNAPSHOT_SCAN_MESSAGE_LIMIT) return messages;
	return messages.slice(-TODO_SNAPSHOT_SCAN_MESSAGE_LIMIT);
}

function isVisibleThreadMessage(message: Message) {
	return (
		message.role !== 'system' &&
		!(
			message.role === 'assistant' &&
			message.status === 'complete' &&
			(message.parts?.length ?? 0) === 0
		)
	);
}

function isPendingEmptyAssistant(
	message: Message,
	currentMessageId: string | null,
) {
	return (
		message.role === 'assistant' &&
		message.status === 'pending' &&
		(message.parts?.length ?? 0) === 0 &&
		message.id !== currentMessageId
	);
}

function isActiveAssistantMessage(
	message: Message,
	currentMessageId: string | null,
	queuedMessageIds: Set<string>,
) {
	return (
		message.role === 'assistant' &&
		(message.id === currentMessageId ||
			(message.status === 'pending' && !queuedMessageIds.has(message.id)))
	);
}

export function filterThreadMessages(
	messages: Message[],
	currentMessageId: string | null,
	queueLength: number,
	queuedMessageIds: Set<string>,
) {
	const visibleMessages = messages.filter(isVisibleThreadMessage);
	const queueBusy = Boolean(currentMessageId) || queueLength > 0;

	if (!queueBusy) return visibleMessages;

	const nextAssistantByIndex = new Array<Message | undefined>(
		visibleMessages.length,
	);
	let nextAssistant: Message | undefined;
	for (let index = visibleMessages.length - 1; index >= 0; index--) {
		nextAssistantByIndex[index] = nextAssistant;
		const message = visibleMessages[index];
		if (message?.role === 'assistant') {
			nextAssistant = message;
		}
	}

	const hasEarlierActiveAssistantByIndex = new Array<boolean>(
		visibleMessages.length,
	);
	let hasEarlierActiveAssistant = false;
	for (let index = 0; index < visibleMessages.length; index++) {
		hasEarlierActiveAssistantByIndex[index] = hasEarlierActiveAssistant;
		const message = visibleMessages[index];
		if (
			message &&
			isActiveAssistantMessage(message, currentMessageId, queuedMessageIds)
		) {
			hasEarlierActiveAssistant = true;
		}
	}

	return visibleMessages.filter((message, index) => {
		if (message.role === 'assistant') {
			return !isPendingEmptyAssistant(message, currentMessageId);
		}

		if (message.role !== 'user') return true;

		const nextAssistant = nextAssistantByIndex[index];
		if (nextAssistant) {
			const nextAssistantIsQueued =
				queuedMessageIds.has(nextAssistant.id) ||
				isPendingEmptyAssistant(nextAssistant, currentMessageId);
			return !nextAssistantIsQueued;
		}

		return !hasEarlierActiveAssistantByIndex[index];
	});
}
