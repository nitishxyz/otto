import { create } from 'zustand';

/** Viewport-space geometry of the composer at the moment a session is created. */
export interface ComposerRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

type HandoffConsumer = 'composer' | 'thread';

interface SessionHandoff {
	sessionId: string;
	rect: ComposerRect;
	createdAt: number;
	claimedAt: Partial<Record<HandoffConsumer, number>>;
}

interface SessionTransitionState {
	handoff: SessionHandoff | null;
	startHandoff: (sessionId: string, rect: ComposerRect) => void;
	/**
	 * Returns the captured composer rect while the handoff is still fresh and the
	 * consumer has not already run past its re-claim window.
	 */
	claimHandoff: (
		sessionId: string,
		consumer: HandoffConsumer,
	) => ComposerRect | null;
	clearHandoff: () => void;
}

/** Handoffs older than this are treated as stale (slow network, back nav, ...). */
const HANDOFF_MAX_AGE_MS = 1500;
/**
 * The composer remounts right after mounting (chat input key bump), so a claim
 * stays valid briefly instead of being strictly one-shot.
 */
const RECLAIM_WINDOW_MS = 300;

export const useSessionTransitionStore = create<SessionTransitionState>(
	(set, get) => ({
		handoff: null,
		startHandoff: (sessionId, rect) =>
			set({
				handoff: {
					sessionId,
					rect,
					createdAt: Date.now(),
					claimedAt: {},
				},
			}),
		claimHandoff: (sessionId, consumer) => {
			const handoff = get().handoff;
			if (!handoff || handoff.sessionId !== sessionId) return null;

			const now = Date.now();
			if (now - handoff.createdAt > HANDOFF_MAX_AGE_MS) {
				set({ handoff: null });
				return null;
			}

			const firstClaimedAt = handoff.claimedAt[consumer];
			if (
				firstClaimedAt !== undefined &&
				now - firstClaimedAt > RECLAIM_WINDOW_MS
			) {
				return null;
			}

			set({
				handoff: {
					...handoff,
					claimedAt: {
						...handoff.claimedAt,
						[consumer]: firstClaimedAt ?? now,
					},
				},
			});
			return handoff.rect;
		},
		clearHandoff: () => set({ handoff: null }),
	}),
);

/** Captures the composer geometry that a session handoff animates from. */
export function captureComposerRect(
	element: HTMLElement | null | undefined,
): ComposerRect | null {
	if (!element) return null;
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return null;
	return {
		top: rect.top,
		left: rect.left,
		width: rect.width,
		height: rect.height,
	};
}
