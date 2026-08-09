import type { Session } from '../../types/api';

export interface ThreadCompactModeInput {
	/** Callers that always want the compact renderer (looper orchestrator UI). */
	forceCompact?: boolean;
	sessionType?: Session['sessionType'];
	/** `preferences.compactThread` — the user-facing "compact thread" toggle. */
	compactThreadPreference: boolean;
}

export interface ThreadCompactMode {
	/** Drives the row model: exploratory parts collapse to activity lines. */
	compact: boolean;
	/** Lets a narrow thread use compact *density* without compact rendering. */
	responsiveCompact: boolean;
}

/**
 * Single source of truth for how the compact-thread preference reaches the
 * thread rows. Kept as plain logic so the preference → row-variant path is
 * testable without mounting the virtualized list.
 */
export function resolveThreadCompactMode({
	forceCompact,
	sessionType,
	compactThreadPreference,
}: ThreadCompactModeInput): ThreadCompactMode {
	// Looper orchestrator threads always use the compact renderer so looper's
	// verify/complete/dispatch tool activity collapses into activity lines.
	const isLooperThread = Boolean(forceCompact) || sessionType === 'looper';
	return {
		compact: isLooperThread || compactThreadPreference,
		responsiveCompact: compactThreadPreference,
	};
}
