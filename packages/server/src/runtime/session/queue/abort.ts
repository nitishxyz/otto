import {
	abortActiveShellsForMessage,
	abortActiveShellsForSession,
} from '../../tools/active-shells.ts';
import type {
	RunAbortReason,
	SendNowPreemptReason,
	SendQueuedMessageNowResult,
} from './types.ts';
import {
	abortAndDeleteMessageController,
	getRunnerStateInternal,
	publishQueueState,
} from './state.ts';

/**
 * Aborts the currently running message for a session.
 * Optionally clears the queue.
 */
export function abortSession(
	sessionId: string,
	clearQueue = false,
	reason?: RunAbortReason,
): void {
	const state = getRunnerStateInternal(sessionId);
	if (!state) {
		abortActiveShellsForSession(sessionId);
		return;
	}

	// Abort the currently running message.
	if (state.currentMessageId) {
		abortActiveShellsForMessage(
			sessionId,
			state.currentMessageId,
			state.projectRoot,
		);
		abortAndDeleteMessageController(
			state.currentMessageId,
			reason,
			state.projectRoot,
		);
	}

	// Optionally clear the queue and abort all queued messages.
	if (clearQueue && state.queue.length > 0) {
		for (const opts of state.queue) {
			abortAndDeleteMessageController(
				opts.assistantMessageId,
				reason,
				opts.projectRoot,
			);
		}
		state.queue = [];
		publishQueueState(sessionId);
	}
}

/**
 * Aborts a specific message by its ID.
 * If it's currently running, aborts the stream.
 * If it's queued, removes it from the queue.
 */
export function abortMessage(
	sessionId: string,
	messageId: string,
): { removed: boolean; wasRunning: boolean } {
	const state = getRunnerStateInternal(sessionId);
	if (!state) {
		const abortedShells = abortActiveShellsForMessage(sessionId, messageId);
		return { removed: abortedShells > 0, wasRunning: abortedShells > 0 };
	}

	// Check if this is the currently running message.
	if (state.currentMessageId === messageId) {
		abortActiveShellsForMessage(sessionId, messageId, state.projectRoot);
		abortAndDeleteMessageController(messageId, undefined, state.projectRoot);
		return { removed: true, wasRunning: true };
	}

	// Check if it's in the queue.
	const index = state.queue.findIndex(
		(opts) => opts.assistantMessageId === messageId,
	);
	if (index !== -1) {
		const [removed] = state.queue.splice(index, 1);
		abortAndDeleteMessageController(messageId, undefined, removed.projectRoot);
		publishQueueState(sessionId);
		return { removed: true, wasRunning: false };
	}

	const abortedShells = abortActiveShellsForMessage(
		sessionId,
		messageId,
		state.projectRoot,
	);
	return { removed: abortedShells > 0, wasRunning: abortedShells > 0 };
}

/**
 * Removes a queued message (not the currently running one).
 */
export function removeFromQueue(sessionId: string, messageId: string): boolean {
	const state = getRunnerStateInternal(sessionId);
	if (!state) return false;

	// Don't allow removing the currently running message via this function.
	if (state.currentMessageId === messageId) {
		return false;
	}

	const index = state.queue.findIndex(
		(opts) => opts.assistantMessageId === messageId,
	);
	if (index === -1) return false;

	const [removed] = state.queue.splice(index, 1);
	abortAndDeleteMessageController(messageId, undefined, removed.projectRoot);

	publishQueueState(sessionId);
	return true;
}

/**
 * Moves a queued message to the front and silently preempts the active run.
 */
export function sendQueuedMessageNow(
	sessionId: string,
	messageId: string,
	processQueueFn: (sessionId: string) => Promise<void>,
): SendQueuedMessageNowResult {
	const state = getRunnerStateInternal(sessionId);
	if (!state) return { success: false };

	if (state.currentMessageId === messageId) {
		return {
			success: true,
			promoted: false,
			wasQueued: false,
			wasRunning: true,
			preemptedMessageId: null,
		};
	}

	const index = state.queue.findIndex(
		(opts) => opts.assistantMessageId === messageId,
	);
	if (index === -1) return { success: false };

	const [job] = state.queue.splice(index, 1);
	state.queue.unshift(job);

	const wasRunning = state.running && Boolean(state.currentMessageId);
	const preemptedMessageId = wasRunning ? state.currentMessageId : null;

	if (preemptedMessageId) {
		abortAndDeleteMessageController(
			preemptedMessageId,
			{
				type: 'send-now-preempt',
				nextMessageId: messageId,
			} satisfies SendNowPreemptReason,
			state.projectRoot,
		);
	}

	publishQueueState(sessionId);

	if (!state.running) {
		void processQueueFn(sessionId);
	}

	return {
		success: true,
		promoted: index > 0,
		wasQueued: true,
		wasRunning,
		preemptedMessageId,
	};
}
