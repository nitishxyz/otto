import type { ProviderName } from '../provider/index.ts';
import { publish, publishClientEvent } from '../../events/bus.ts';
import type { ToolApprovalMode } from '../tools/approval.ts';
import type { ReasoningLevel } from '@ottocode/sdk';

export type RunOpts = {
	sessionId: string;
	assistantMessageId: string;
	agent: string;
	provider: ProviderName;
	model: string;
	projectRoot: string;
	queuedAt?: number;
	oneShot?: boolean;
	userContent?: string;
	userContext?: string;
	estimatedInputTokens?: number;
	reasoningText?: boolean;
	reasoningLevel?: ReasoningLevel;
	abortSignal?: AbortSignal;
	/**
	 * Omits prior session history from prompt assembly only. The run still emits
	 * events, tool calls, and persisted message parts in the current session.
	 */
	omitHistory?: boolean;
	isCompactCommand?: boolean;
	compactionContext?: string;
	additionalPromptMessages?: Array<{
		role: 'system' | 'user';
		content: string;
	}>;
	toolApprovalMode?: ToolApprovalMode;
	compactionRetries?: number;
	continuationCount?: number;
};

export type QueuedMessage = {
	messageId: string;
	position: number;
};

export type SendNowPreemptReason = {
	type: 'send-now-preempt';
	nextMessageId: string;
};

/** Returns whether an abort reason came from the send-now preemption flow. */
export function isSendNowPreemptReason(
	value: unknown,
): value is SendNowPreemptReason {
	return (
		Boolean(value) &&
		typeof value === 'object' &&
		(value as { type?: unknown }).type === 'send-now-preempt' &&
		typeof (value as { nextMessageId?: unknown }).nextMessageId === 'string'
	);
}

type RunnerState = {
	queue: RunOpts[];
	running: boolean;
	currentMessageId: string | null;
};

// Global state for session queues
const runners = new Map<string, RunnerState>();

// Track active abort controllers per MESSAGE (not session)
const messageAbortControllers = new Map<string, AbortController>();

function publishQueueState(sessionId: string) {
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

/**
 * Enqueues an assistant run for a given session.
 * Creates an abort controller per message.
 */
export function enqueueAssistantRun(
	opts: Omit<RunOpts, 'abortSignal' | 'queuedAt'>,
	processQueueFn: (sessionId: string) => Promise<void>,
	options?: { front?: boolean },
) {
	const abortController = new AbortController();
	messageAbortControllers.set(opts.assistantMessageId, abortController);

	const state = runners.get(opts.sessionId) ?? {
		queue: [],
		running: false,
		currentMessageId: null,
	};
	const job = {
		...opts,
		queuedAt: globalThis.performance?.now?.() ?? Date.now(),
		abortSignal: abortController.signal,
	};
	if (options?.front) {
		state.queue.unshift(job);
	} else {
		state.queue.push(job);
	}
	runners.set(opts.sessionId, state);

	publishQueueState(opts.sessionId);

	if (!state.running) void processQueueFn(opts.sessionId);
}

/**
 * Aborts the currently running message for a session.
 * Optionally clears the queue.
 */
export function abortSession(sessionId: string, clearQueue = false) {
	const state = runners.get(sessionId);
	if (!state) return;

	// Abort the currently running message
	if (state.currentMessageId) {
		const controller = messageAbortControllers.get(state.currentMessageId);
		if (controller) {
			controller.abort();
			messageAbortControllers.delete(state.currentMessageId);
		}
	}

	// Optionally clear the queue and abort all queued messages
	if (clearQueue && state.queue.length > 0) {
		for (const opts of state.queue) {
			const controller = messageAbortControllers.get(opts.assistantMessageId);
			if (controller) {
				controller.abort();
				messageAbortControllers.delete(opts.assistantMessageId);
			}
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
	const state = runners.get(sessionId);
	if (!state) return { removed: false, wasRunning: false };

	// Check if this is the currently running message
	if (state.currentMessageId === messageId) {
		const controller = messageAbortControllers.get(messageId);
		if (controller) {
			controller.abort();
			messageAbortControllers.delete(messageId);
		}
		return { removed: true, wasRunning: true };
	}

	// Check if it's in the queue
	const index = state.queue.findIndex(
		(opts) => opts.assistantMessageId === messageId,
	);
	if (index !== -1) {
		state.queue.splice(index, 1);
		const controller = messageAbortControllers.get(messageId);
		if (controller) {
			controller.abort();
			messageAbortControllers.delete(messageId);
		}
		publishQueueState(sessionId);
		return { removed: true, wasRunning: false };
	}

	return { removed: false, wasRunning: false };
}

/**
 * Removes a queued message (not the currently running one).
 */
export function removeFromQueue(sessionId: string, messageId: string): boolean {
	const state = runners.get(sessionId);
	if (!state) return false;

	// Don't allow removing the currently running message via this function
	if (state.currentMessageId === messageId) {
		return false;
	}

	const index = state.queue.findIndex(
		(opts) => opts.assistantMessageId === messageId,
	);
	if (index === -1) return false;

	state.queue.splice(index, 1);
	const controller = messageAbortControllers.get(messageId);
	if (controller) {
		controller.abort();
		messageAbortControllers.delete(messageId);
	}

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
):
	| {
			success: true;
			promoted: boolean;
			wasQueued: boolean;
			wasRunning: boolean;
			preemptedMessageId: string | null;
	  }
	| { success: false } {
	const state = runners.get(sessionId);
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
		const controller = messageAbortControllers.get(preemptedMessageId);
		if (controller) {
			controller.abort({
				type: 'send-now-preempt',
				nextMessageId: messageId,
			} satisfies SendNowPreemptReason);
			messageAbortControllers.delete(preemptedMessageId);
		}
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

/**
 * Gets the current queue state for a session.
 */
export function getQueueState(sessionId: string): {
	currentMessageId: string | null;
	queuedMessages: QueuedMessage[];
	isRunning: boolean;
} | null {
	const state = runners.get(sessionId);
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
): { queue: RunOpts[]; running: boolean } | undefined {
	return runners.get(sessionId);
}

export function setRunning(sessionId: string, running: boolean) {
	const state = runners.get(sessionId);
	if (state) state.running = running;
}

export function setCurrentMessage(sessionId: string, messageId: string | null) {
	const state = runners.get(sessionId);
	if (state) {
		state.currentMessageId = messageId;
		publishQueueState(sessionId);
		if (messageId) {
			publishClientEvent({
				type: 'session.status',
				payload: {
					sessionId,
					status: 'running',
					messageId,
					createdAt: new Date().toISOString(),
				},
			});
		}
	}
}

export function dequeueJob(sessionId: string): RunOpts | undefined {
	const state = runners.get(sessionId);
	const job = state?.queue.shift();
	if (job && state) {
		state.currentMessageId = job.assistantMessageId;
		publishQueueState(sessionId);
		publishClientEvent({
			type: 'session.status',
			payload: {
				sessionId,
				status: 'running',
				messageId: job.assistantMessageId,
				createdAt: new Date().toISOString(),
			},
		});
	}
	return job;
}

export function cleanupSession(sessionId: string) {
	const state = runners.get(sessionId);
	if (state && state.queue.length === 0 && !state.running) {
		// Clean up any lingering abort controller for current message
		if (state.currentMessageId) {
			messageAbortControllers.delete(state.currentMessageId);
		}
		state.currentMessageId = null;
		runners.delete(sessionId);
		publishQueueState(sessionId);
	}
}
