import type { RunOpts } from './types.ts';
import {
	getOrCreateRunnerState,
	publishQueueState,
	setMessageAbortController,
} from './state.ts';

/**
 * Enqueues an assistant run for a given session.
 * Creates an abort controller per message.
 */
export function enqueueAssistantRun(
	opts: Omit<RunOpts, 'abortSignal' | 'queuedAt'>,
	processQueueFn: (sessionId: string) => Promise<void>,
	options?: { front?: boolean },
): void {
	const abortController = new AbortController();
	setMessageAbortController(opts.assistantMessageId, abortController);

	const state = getOrCreateRunnerState(opts.sessionId);
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

	publishQueueState(opts.sessionId);

	if (!state.running) void processQueueFn(opts.sessionId);
}
