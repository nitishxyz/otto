import { publishClientEvent } from '../../../events/bus.ts';
import type { QueueStateSnapshot, RunnerState, RunOpts } from './types.ts';
import {
	deleteMessageAbortController,
	deleteRunnerState,
	getRunnerStateInternal,
	publishQueueState,
} from './state.ts';

function publishRunningStatus(
	sessionId: string,
	messageId: string,
	state?: RunnerState,
): void {
	publishClientEvent({
		type: 'session.status',
		payload: {
			sessionId,
			projectId: state?.projectId,
			projectRoot: state?.projectRoot,
			status: 'running',
			messageId,
			createdAt: new Date().toISOString(),
		},
	});
}

/**
 * Gets the current queue state for a session.
 */
export function getQueueState(sessionId: string): QueueStateSnapshot | null {
	const state = getRunnerStateInternal(sessionId);
	if (!state) return null;

	return {
		currentMessageId: state.currentMessageId,
		queuedMessages: state.queue.map((opts, index) => ({
			messageId: opts.assistantMessageId,
			position: index,
		})),
		isRunning: state.running,
	};
}

export function getRunnerState(sessionId: string): RunnerState | undefined {
	return getRunnerStateInternal(sessionId);
}

export function setRunning(sessionId: string, running: boolean): void {
	const state = getRunnerStateInternal(sessionId);
	if (state) state.running = running;
}

export function setCurrentMessage(
	sessionId: string,
	messageId: string | null,
): void {
	const state = getRunnerStateInternal(sessionId);
	if (state) {
		state.currentMessageId = messageId;
		publishQueueState(sessionId);
		if (messageId) publishRunningStatus(sessionId, messageId, state);
	}
}

export function dequeueJob(sessionId: string): RunOpts | undefined {
	const state = getRunnerStateInternal(sessionId);
	const job = state?.queue.shift();
	if (job && state) {
		state.currentMessageId = job.assistantMessageId;
		publishQueueState(sessionId);
		publishRunningStatus(sessionId, job.assistantMessageId, state);
	}
	return job;
}

export function cleanupSession(sessionId: string): void {
	const state = getRunnerStateInternal(sessionId);
	if (state && state.queue.length === 0 && !state.running) {
		// Clean up any lingering abort controller for current message.
		if (state.currentMessageId) {
			deleteMessageAbortController(state.currentMessageId, state.projectRoot);
		}
		state.currentMessageId = null;
		deleteRunnerState(sessionId);
		publishQueueState(sessionId);
	}
}
