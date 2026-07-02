import { publish } from '../../../events/bus.ts';
import { scopedMessageKey } from '../../projects/scope.ts';
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
		projectId: undefined,
		projectRoot: undefined,
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

export interface QueueStats {
	runnerStates: number;
	runningRunners: number;
	queuedMessages: number;
	messageAbortControllers: number;
}

export function getQueueStats(): QueueStats {
	let running = 0;
	let queued = 0;
	for (const state of runners.values()) {
		if (state.running) running += 1;
		queued += state.queue.length;
	}
	return {
		runnerStates: runners.size,
		runningRunners: running,
		queuedMessages: queued,
		messageAbortControllers: messageAbortControllers.size,
	};
}

export function setMessageAbortController(
	messageId: string,
	controller: AbortController,
	projectKey?: string,
): void {
	messageAbortControllers.set(
		scopedMessageKey(projectKey, messageId),
		controller,
	);
}

export function getMessageAbortController(
	messageId: string,
	projectKey?: string,
): AbortController | undefined {
	return messageAbortControllers.get(scopedMessageKey(projectKey, messageId));
}

export function deleteMessageAbortController(
	messageId: string,
	projectKey?: string,
): void {
	messageAbortControllers.delete(scopedMessageKey(projectKey, messageId));
}

export function abortAndDeleteMessageController(
	messageId: string,
	reason?: unknown,
	projectKey?: string,
): boolean {
	const key = scopedMessageKey(projectKey, messageId);
	const controller = messageAbortControllers.get(key);
	if (!controller) return false;
	controller.abort(reason);
	messageAbortControllers.delete(key);
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
		projectId: state?.projectId,
		projectRoot: state?.projectRoot,
		payload: {
			currentMessageId: state?.currentMessageId ?? null,
			queuedMessages,
			queueLength: queue.length,
			isRunning: state?.running ?? false,
		},
	});
}
