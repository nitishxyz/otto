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
export function getQueueState(
	sessionId: string,
	projectRoot?: string,
): QueueStateSnapshot | null {
	const state = getRunnerStateInternal(sessionId, projectRoot);
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

export function getRunnerState(
	sessionId: string,
	projectRoot?: string,
): RunnerState | undefined {
	return getRunnerStateInternal(sessionId, projectRoot);
}

export function setRunning(
	sessionId: string,
	running: boolean,
	projectRoot?: string,
): void {
	const state = getRunnerStateInternal(sessionId, projectRoot);
	if (state) state.running = running;
}

export function setCurrentMessage(
	sessionId: string,
	messageId: string | null,
	projectRoot?: string,
): void {
	const state = getRunnerStateInternal(sessionId, projectRoot);
	if (state) {
		state.currentMessageId = messageId;
		publishQueueState(sessionId, state.projectRoot);
		if (messageId) publishRunningStatus(sessionId, messageId, state);
	}
}

function startJob(
	sessionId: string,
	state: RunnerState,
	job: RunOpts,
): RunOpts {
	if (
		state.currentMessageId &&
		state.currentMessageId !== job.assistantMessageId
	) {
		deleteMessageAbortController(state.currentMessageId, state.projectRoot);
	}
	state.currentMessageId = job.assistantMessageId;
	publishQueueState(sessionId, state.projectRoot);
	publishRunningStatus(sessionId, job.assistantMessageId, state);
	return job;
}

export function dequeueJob(
	sessionId: string,
	projectRoot?: string,
): RunOpts | undefined {
	const state = getRunnerStateInternal(sessionId, projectRoot);
	const job = state?.queue.shift();
	if (job && state) startJob(sessionId, state, job);
	return job;
}

/**
 * Synchronously claims the runner for a session. Returns false when no queue
 * state exists or another loop already owns it.
 */
export function acquireSessionRunner(
	sessionId: string,
	projectRoot?: string,
): boolean {
	const state = getRunnerStateInternal(sessionId, projectRoot);
	if (!state || state.running) return false;
	state.running = true;
	return true;
}

/**
 * Synchronously takes the next job, or releases the runner and cleans up when
 * the queue is empty. Dequeue, empty check, and release happen in one
 * uninterrupted step so an enqueue can never land between them.
 */
export function takeNextJobOrRelease(
	sessionId: string,
	projectRoot?: string,
): RunOpts | undefined {
	const state = getRunnerStateInternal(sessionId, projectRoot);
	if (!state) return undefined;
	const job = state.queue.shift();
	if (job) return startJob(sessionId, state, job);
	state.running = false;
	cleanupSession(sessionId, state.projectRoot);
	return undefined;
}

/**
 * Releases the runner after an unexpected loop exit. Returns true when jobs
 * remain queued so the caller can restart processing.
 */
export function releaseSessionRunner(
	sessionId: string,
	projectRoot?: string,
): boolean {
	const state = getRunnerStateInternal(sessionId, projectRoot);
	if (!state) return false;
	state.running = false;
	if (state.queue.length > 0) return true;
	cleanupSession(sessionId, state.projectRoot);
	return false;
}

export function cleanupSession(sessionId: string, projectRoot?: string): void {
	const state = getRunnerStateInternal(sessionId, projectRoot);
	if (state && state.queue.length === 0 && !state.running) {
		// Clean up any lingering abort controller for current message.
		if (state.currentMessageId) {
			deleteMessageAbortController(state.currentMessageId, state.projectRoot);
		}
		state.currentMessageId = null;
		deleteRunnerState(sessionId, state.projectRoot, state);
		publishQueueState(sessionId, state.projectRoot, state);
	}
}
