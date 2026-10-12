import type { ProcessQueueFn } from '../../session/queue/enqueue.ts';
import type { AbortEvent, FinishEvent } from '../../stream/types.ts';

export type RunSessionLoop = ProcessQueueFn;

export type ContinuationKind =
	| 'stream-idle-retry'
	| 'context-overflow'
	| 'max-output'
	| 'auto-compact';

export type TurnOutcomeKind =
	| 'completed'
	| 'continued'
	| 'empty'
	| 'failed'
	| 'aborted';

export type TurnFacts = {
	finish?: FinishEvent;
	errors: unknown[];
	persistenceError?: unknown;
	abort?: AbortEvent;
};
