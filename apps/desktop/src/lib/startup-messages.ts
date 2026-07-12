/**
 * Rotating status lines shown on the desktop startup gate while the daemon
 * and bootstrap checks run. The sequence is playful but still signals
 * startup progress, and settles on the final line.
 */
export const STARTUP_MESSAGES = [
	'Summoning the daemon…',
	'Firing things up…',
	'Convincing electrons to cooperate…',
	'Preparing your workspace…',
	'Almost there…',
] as const;

/** How long each startup message stays on screen before advancing. */
export const STARTUP_MESSAGE_INTERVAL_MS = 2400;

/**
 * Advance to the next startup message index, holding on the last message
 * instead of looping back to the opener.
 */
export function nextStartupMessageIndex(index: number): number {
	if (!Number.isInteger(index) || index < 0) return 0;
	return Math.min(index + 1, STARTUP_MESSAGES.length - 1);
}
