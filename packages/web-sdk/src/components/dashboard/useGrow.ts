import { useEffect, useState } from 'react';

function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Returns `false` for one painted frame, then `true`.
 *
 * Bars render at zero size while this is `false` and at their real size once it
 * flips, so a CSS transition on `width`/`height` plays the grow-in that the
 * OttoRouter dashboard gets from Recharts' `animationDuration`. Changing
 * `resetKey` (metric, sort, range…) replays it.
 */
export function useGrow(resetKey?: string | number): boolean {
	const [state, setState] = useState({ key: resetKey, grown: false });

	// Reset while rendering rather than in an effect, so the collapsed state is
	// the first thing painted after the key changes instead of a frame later.
	if (state.key !== resetKey) setState({ key: resetKey, grown: false });

	useEffect(() => {
		if (prefersReducedMotion()) {
			setState({ key: resetKey, grown: true });
			return;
		}
		// Two nested frames are required: the first only schedules work before
		// the next paint, so the collapsed state would otherwise be coalesced
		// into the same frame as the final state and nothing would animate.
		let inner = 0;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() =>
				setState({ key: resetKey, grown: true }),
			);
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, [resetKey]);

	return state.grown;
}

/** Matches the 650ms ease-out Recharts uses in the OttoRouter dashboard. */
export const GROW_MS = 650;
export const GROW_TRANSITION = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Per-item entry delay in milliseconds, capped so a long series still finishes
 * promptly instead of trickling in for several seconds.
 */
export function growDelay(index: number, total: number): number {
	if (total <= 1) return 0;
	const step = total > 40 ? 4 : total > 16 ? 12 : 26;
	return Math.min(index * step, 320);
}
