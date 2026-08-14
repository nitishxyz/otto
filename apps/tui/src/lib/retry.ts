import type { Message } from '../types.ts';

/** Returns the newest persisted assistant message that can be retried. */
export function getLastFailedAssistantMessage(
	messages: readonly Message[],
): Message | null {
	let latest: Message | null = null;
	for (const message of messages) {
		if (
			message.role !== 'assistant' ||
			message.status !== 'error' ||
			!message.sessionId
		) {
			continue;
		}
		if (!latest || message.createdAt >= latest.createdAt) latest = message;
	}
	return latest;
}

export function getRetryErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	if (!error || typeof error !== 'object') return 'Failed to retry request';
	const payload = error as { error?: unknown; message?: unknown };
	if (typeof payload.message === 'string') return payload.message;
	if (typeof payload.error === 'string') return payload.error;
	if (payload.error && typeof payload.error === 'object') {
		const nested = payload.error as { message?: unknown };
		if (typeof nested.message === 'string') return nested.message;
	}
	return 'Failed to retry request';
}
