export interface ThreadCompactModeInput {
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
	compactThreadPreference,
}: ThreadCompactModeInput): ThreadCompactMode {
	return {
		compact: compactThreadPreference,
		responsiveCompact: compactThreadPreference,
	};
}
