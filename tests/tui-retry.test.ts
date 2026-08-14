import { describe, expect, test } from 'bun:test';
import { getLastFailedAssistantMessage } from '../apps/tui/src/lib/retry.ts';
import type { Message } from '../apps/tui/src/types.ts';

function makeMessage(overrides: Partial<Message>): Message {
	return {
		id: 'message',
		sessionId: 'session',
		role: 'assistant',
		status: 'complete',
		agent: 'build',
		provider: 'provider',
		model: 'model',
		createdAt: 1,
		completedAt: null,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		error: null,
		parts: [],
		...overrides,
	};
}

describe('TUI retry selection', () => {
	test('selects only the newest persisted failed assistant message', () => {
		const messages = [
			makeMessage({ id: 'new-complete', createdAt: 50 }),
			makeMessage({ id: 'old-failed', status: 'error', createdAt: 10 }),
			makeMessage({
				id: 'synthetic-failed',
				sessionId: '',
				status: 'error',
				createdAt: 100,
			}),
			makeMessage({ id: 'new-failed', status: 'error', createdAt: 20 }),
			makeMessage({
				id: 'user-failed',
				role: 'user',
				status: 'error',
				createdAt: 200,
			}),
		];

		expect(getLastFailedAssistantMessage(messages)?.id).toBe('new-failed');
	});

	test('returns null when there is no retryable failure', () => {
		expect(
			getLastFailedAssistantMessage([
				makeMessage({ id: 'complete' }),
				makeMessage({ id: 'synthetic', sessionId: '', status: 'error' }),
			]),
		).toBeNull();
	});
});
