import { publish } from '../../../events/bus.ts';
import { scopedMessageKey, scopedSessionKey } from '../../projects/scope.ts';
import type { QueuedMessage, RunnerState } from './types.ts';

// Runner state keyed by project root + session id.
const runners = new Map<string, RunnerState>();
// Session id -> scoped runner keys, for callers that only know the session id.
const sessionKeys = new Map<string, Set<string>>();

// Track active abort controllers per MESSAGE (not session).
const messageAbortControllers = new Map<string, AbortController>();

function resolveRunnerKey(
	sessionId: string,
	projectRoot?: string,
): string | undefined {
	if (projectRoot) return scopedSessionKey(projectRoot, sessionId);
	const keys = sessionKeys.get(sessionId);
	if (!keys || keys.size === 0) return undefined;
	if (keys.size > 1)
		throw new Error('Ambiguous session queue: projectRoot is required');
	return keys.values().next().value;
}

export function getRunnerStateInternal(
	sessionId: string,
	projectRoot?: string,
): RunnerState | undefined {
	const key = resolveRunnerKey(sessionId, projectRoot);
	return key ? runners.get(key) : undefined;
}

export function getOrCreateRunnerState(
	sessionId: string,
	projectRoot?: string,
): RunnerState {
	const key = scopedSessionKey(projectRoot, sessionId);
	const existing = runners.get(key);
	if (existing) return existing;
	const state: RunnerState = {
		projectId: undefined,
		projectRoot,
		queue: [],
		running: false,
		currentMessageId: null,
	};
	runners.set(key, state);
	const keys = sessionKeys.get(sessionId) ?? new Set<string>();
	keys.add(key);
	sessionKeys.set(sessionId, keys);
	return state;
}

export function deleteRunnerState(
	sessionId: string,
	projectRoot?: string,
	state?: RunnerState,
): void {
	const key = state
		? Array.from(sessionKeys.get(sessionId) ?? []).find(
				(candidate) => runners.get(candidate) === state,
			)
		: resolveRunnerKey(sessionId, projectRoot);
	if (!key) return;
	runners.delete(key);
	const keys = sessionKeys.get(sessionId);
	keys?.delete(key);
	if (keys && keys.size === 0) sessionKeys.delete(sessionId);
}

export interface QueueStats {
	runnerStates: number;
	runningRunners: number;
	queuedMessages: number;
	messageAbortControllers: number;
}

export function hasActiveProjectQueue(
	projectId: string,
	projectRoot: string,
): boolean {
	for (const state of runners.values()) {
		if (!state.running && state.queue.length === 0) continue;
		if (state.projectId === projectId || state.projectRoot === projectRoot) {
			return true;
		}
	}
	return false;
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

/** Publishes a queue snapshot; pass `state` when it was already removed. */
export function publishQueueState(
	sessionId: string,
	projectRoot?: string,
	stateOverride?: RunnerState,
): void {
	const state = stateOverride ?? getRunnerStateInternal(sessionId, projectRoot);
	const removed = stateOverride !== undefined;
	const queue = removed ? [] : (state?.queue ?? []);

	const queuedMessages: QueuedMessage[] = queue.map((opts, index) => ({
		messageId: opts.assistantMessageId,
		position: index,
	}));

	publish({
		type: 'queue.updated',
		sessionId,
		projectId: state?.projectId,
		projectRoot: state?.projectRoot ?? projectRoot,
		payload: {
			currentMessageId: removed ? null : (state?.currentMessageId ?? null),
			queuedMessages,
			queueLength: queue.length,
			isRunning: removed ? false : (state?.running ?? false),
		},
	});
}
