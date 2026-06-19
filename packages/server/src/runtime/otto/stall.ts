const MAX_STALLED_WAKEUPS = 3;

export const AUTOMATED_PREFIXES = [
	'[automated]',
	'[otto]',
	'<subagent_results>',
	// Legacy worker-goal kickoff marker; retained so old automated messages do
	// not count as manual user input when calculating otto stall state.
	'<goal_start',
	'<otto_kickoff',
	'<otto_wakeup',
];

type StallState = {
	stalls: number;
	lastHash: string;
};

/** Stall counters keyed by goal id (fallback: session id when no goal). */
const stallStates = new Map<string, StallState>();

/**
 * Clears the stall counter for a goal (or legacy session key), e.g. when the
 * user explicitly (re)starts a goal.
 */
export function resetOttoStallState(key: string): void {
	stallStates.delete(key);
}

export function clearOttoStallState(...keys: string[]): void {
	for (const key of keys) stallStates.delete(key);
}

export function shouldStopForOttoStall(args: {
	stallKey: string;
	hash: string;
}): { stop: boolean; stalls: number } {
	const state = stallStates.get(args.stallKey);
	if (state && state.lastHash === args.hash) {
		state.stalls += 1;
		return {
			stop: state.stalls >= MAX_STALLED_WAKEUPS,
			stalls: state.stalls,
		};
	}
	stallStates.set(args.stallKey, { stalls: 0, lastHash: args.hash });
	return { stop: false, stalls: 0 };
}
