import type { SendNowPreemptReason, SystemAbortReason } from './types.ts';

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

export function isSystemAbortReason(
	value: unknown,
): value is SystemAbortReason {
	const type =
		Boolean(value) && typeof value === 'object'
			? (value as { type?: unknown }).type
			: undefined;
	return (
		type === 'parent-session-aborted' || type === 'subagent-stopped-by-parent'
	);
}
