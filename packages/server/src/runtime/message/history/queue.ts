import type { MessageRow } from './types.ts';

export function findQueuedUserMessageIds(
	rows: MessageRow[],
	queuedAssistantMessageIds: Set<string>,
): Set<string> {
	const queuedUserMessageIds = new Set<string>();
	if (queuedAssistantMessageIds.size === 0) return queuedUserMessageIds;

	for (const queuedAssistantMessageId of queuedAssistantMessageIds) {
		const assistantIndex = rows.findIndex(
			(row) => row.id === queuedAssistantMessageId,
		);
		if (assistantIndex <= 0) continue;

		const userMessage = rows
			.slice(0, assistantIndex)
			.reverse()
			.find((row) => row.role === 'user');
		if (userMessage) queuedUserMessageIds.add(userMessage.id);
	}

	return queuedUserMessageIds;
}
