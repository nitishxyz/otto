export type OauthCodexTextGuardState = {
	raw: string;
	sanitized: string;
	dropped: boolean;
};

const LEAK_PATTERNS: RegExp[] = [
	/assistant\s+to=/i,
	/assistant\s+to\b/i,
	/\bassistant\b\s*$/i,
	/assistant\s+to=functions\./i,
	/assistant\s+to=functions\b/i,
	/to=functions\.[a-z0-9_]+\s+(commentary|analysis|final)\b/i,
	/call:tool\{/i,
];

function findFirstLeakIndex(text: string): number {
	let index = -1;
	for (const pattern of LEAK_PATTERNS) {
		const match = pattern.exec(text);
		if (!match || match.index < 0) continue;
		if (index === -1 || match.index < index) {
			index = match.index;
		}
	}
	return index;
}

/**
 * Removes codex pseudo tool-call leakage from text streams.
 *
 * Some OAuth Codex responses leak harness syntax (e.g. "assistant to=functions...")
 * into user-facing text. Once such a marker appears, everything from that marker
 * onward is considered non-user text and dropped.
 */
export function stripCodexPseudoToolText(raw: string): {
	sanitized: string;
	dropped: boolean;
} {
	const leakIndex = findFirstLeakIndex(raw);
	if (leakIndex === -1) {
		return { sanitized: raw, dropped: false };
	}
	return {
		sanitized: raw.slice(0, leakIndex).trimEnd(),
		dropped: true,
	};
}

export function createOauthCodexTextGuardState(): OauthCodexTextGuardState {
	return {
		raw: '',
		sanitized: '',
		dropped: false,
	};
}

/**
 * Resets the guard window at structured tool boundaries.
 *
 * The guard accumulates raw text for the WHOLE run; once a pseudo tool-call
 * leak (e.g. "assistant to=functions...") is detected, everything after the
 * leak index is dropped from every later delta - including legitimate prose
 * streamed after the real tool call executed. Since a leak marker only
 * poisons text up to the next structured tool part, reset the window when a
 * tool call/result arrives so post-tool text flows again.
 */
export function resetOauthCodexTextGuard(
	state: OauthCodexTextGuardState,
): void {
	state.raw = '';
	state.sanitized = '';
	state.dropped = false;
}

/**
 * Consumes a raw delta and returns only safe delta text.
 */
export function consumeOauthCodexTextDelta(
	state: OauthCodexTextGuardState,
	rawDelta: string,
): string {
	if (!rawDelta) return '';
	state.raw += rawDelta;
	const next = stripCodexPseudoToolText(state.raw);
	if (next.dropped) state.dropped = true;

	let safeDelta = '';
	if (next.sanitized.startsWith(state.sanitized)) {
		safeDelta = next.sanitized.slice(state.sanitized.length);
	}

	state.sanitized = next.sanitized;
	return safeDelta;
}
