import { useEffect, useState } from 'react';
import {
	STARTUP_MESSAGE_INTERVAL_MS,
	STARTUP_MESSAGES,
	nextStartupMessageIndex,
} from '../lib/startup-messages';

/**
 * Return the current startup status line, rotating through the sequence on
 * an interval. Users with `prefers-reduced-motion` keep the first factual
 * line; the timer is cleaned up on unmount and once the last line is shown.
 */
export function useStartupMessage(): string {
	const [index, setIndex] = useState(0);

	useEffect(() => {
		const prefersReducedMotion =
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (prefersReducedMotion) return;
		const timer = window.setInterval(() => {
			setIndex((current) => {
				const next = nextStartupMessageIndex(current);
				if (next === current) window.clearInterval(timer);
				return next;
			});
		}, STARTUP_MESSAGE_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, []);

	return STARTUP_MESSAGES[index] ?? STARTUP_MESSAGES[0];
}
