import { publish } from '../../../events/bus.ts';
import type { QueuedMessage, RunnerState } from './types.ts';

// Global state for session queues.
const runners = new Map<string, RunnerState>();

// Track active abort controllers per MESSAGE (not session).
const messageAbortControllers = new Map<string, AbortController>();

export function getRunnerStateInternal(
	sessionId: string,
): RunnerState | undefined {
	return runners.get(sessionId);
}

export function getOrCreateRunnerState(sessionId: string): RunnerState {
	const existing = runners.get(sessionId);
	if (existing) return existing;
	const state: RunnerState = {
		queue: [],
		running: false,
		currentMessageId: null,
	};
	runners.set(sessionId, state);
	return state;
}

export function deleteRunnerState(sessionId: string): void {
	runners.delete(sessionId);
}

export function setMessageAbortController(
	messageId: string,
	controller: AbortController,
): void {
	messageAbortControllers.set(messageId, controller);
}

export function getMessageAbortController(
	messageId: string,
): AbortController | undefined {
	return messageAbortControllers.get(messageId);
}

export function deleteMessageAbortController(messageId: string): void {
	messageAbortControllers.delete(messageId);
}

export function abortAndDeleteMessageController(
	messageId: string,
	reason?: unknown,
): boolean {
	const controller = messageAbortControllers.get(messageId);
	if (!controller) return false;
	controller.abort(reason);
	messageAbortControllers.delete(messageId);
	return true;
}

export function publishQueueState(sessionId: string): void {
	const state = runners.get(sessionId);
	const queue = state?.queue ?? [];

	const queuedMessages: QueuedMessage[] = queue.map((opts, index) => ({
		messageId: opts.assistantMessageId,
		position: index,
	}));

	publish({
		type: 'queue.updated',
		sessionId,
		payload: {
			currentMessageId: state?.currentMessageId ?? null,
			queuedMessages,
			queueLength: queue.length,
			isRunning: state?.running ?? false,
		},
	});
}
