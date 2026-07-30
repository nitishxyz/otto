import { useLayoutEffect, type RefObject } from 'react';
import { useSessionTransitionStore } from '../stores/sessionTransitionStore';

const COMPOSER_DURATION_MS = 420;
const THREAD_DURATION_MS = 360;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

function prefersReducedMotion() {
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function canAnimate(element: HTMLElement | null): element is HTMLElement {
	return Boolean(element && typeof element.animate === 'function');
}

/**
 * Slides the composer from where it sat on the new-session landing to its
 * docked position in the freshly created session (shared-element style FLIP).
 */
export function useComposerHandoff(
	sessionId: string | undefined,
	elementRef: RefObject<HTMLElement | null>,
) {
	useLayoutEffect(() => {
		if (!sessionId) return;

		const element = elementRef.current;
		if (!canAnimate(element) || prefersReducedMotion()) return;

		const from = useSessionTransitionStore
			.getState()
			.claimHandoff(sessionId, 'composer');
		if (!from) return;

		const to = element.getBoundingClientRect();
		const dx = from.left + from.width / 2 - (to.left + to.width / 2);
		const dy = from.top - to.top;
		if (
			Math.abs(dx) < 1 &&
			Math.abs(dy) < 1 &&
			Math.abs(from.width - to.width) < 1
		) {
			return;
		}

		const animation = element.animate(
			[
				{
					transform: `translate(${dx}px, ${dy}px)`,
					width: `${from.width}px`,
				},
				{ transform: 'translate(0px, 0px)', width: `${to.width}px` },
			],
			{ duration: COMPOSER_DURATION_MS, easing: EASE_OUT },
		);

		return () => animation.cancel();
	}, [sessionId, elementRef]);
}

/**
 * Lifts the thread into place behind the docked composer so the just-sent
 * message reads as rising out of the input.
 */
export function useThreadHandoff(
	sessionId: string | undefined,
	elementRef: RefObject<HTMLElement | null>,
) {
	useLayoutEffect(() => {
		if (!sessionId) return;

		const element = elementRef.current;
		if (!canAnimate(element) || prefersReducedMotion()) return;

		const claimed = useSessionTransitionStore
			.getState()
			.claimHandoff(sessionId, 'thread');
		if (!claimed) return;

		const animation = element.animate(
			[
				{ opacity: 0, transform: 'translateY(20px)' },
				{ opacity: 1, transform: 'translateY(0px)' },
			],
			{
				duration: THREAD_DURATION_MS,
				easing: EASE_OUT,
				delay: 80,
				fill: 'backwards',
			},
		);

		return () => animation.cancel();
	}, [sessionId, elementRef]);
}
