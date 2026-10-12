import type { RunOpts } from './types.ts';
import {
	captureQueuedCredentials,
	withRequestCredentials,
} from '../../provider/credentials.ts';
import {
	getOrCreateRunnerState,
	publishQueueState,
	setMessageAbortController,
} from './state.ts';

export type ProcessQueueFn = (
	sessionId: string,
	projectRoot?: string,
) => Promise<void>;

/**
 * Enqueues an assistant run for a given session.
 * Creates an abort controller per message.
 */
export function enqueueAssistantRun(
	opts: Omit<RunOpts, 'abortSignal' | 'queuedAt'>,
	processQueueFn: ProcessQueueFn,
	options?: { front?: boolean },
): void {
	const abortController = new AbortController();
	setMessageAbortController(
		opts.assistantMessageId,
		abortController,
		opts.projectRoot,
	);

	const state = getOrCreateRunnerState(opts.sessionId, opts.projectRoot);
	state.projectId = opts.projectId;
	state.projectRoot = opts.projectRoot;
	const job = {
		...opts,
		queuedAt: globalThis.performance?.now?.() ?? Date.now(),
		abortSignal: abortController.signal,
	};
	captureQueuedCredentials(job);
	if (options?.front) {
		state.queue.unshift(job);
	} else {
		state.queue.push(job);
	}

	publishQueueState(opts.sessionId, opts.projectRoot);

	if (!state.running)
		void withRequestCredentials({}, () =>
			processQueueFn(opts.sessionId, opts.projectRoot),
		);
}
