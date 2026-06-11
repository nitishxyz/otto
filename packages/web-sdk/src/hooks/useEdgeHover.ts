import { useEffect, useRef, useState } from 'react';

const HOVER_SHOW_DELAY_MS = 260;
const HOVER_HIDE_DELAY_MS = 120;

interface UseEdgeHoverOptions {
	/** Which window edge triggers the reveal. */
	side: 'left' | 'right';
	/** Master switch — usually `preferences.smartEdges && collapsed`. */
	enabled: boolean;
	/** Fraction of window width that counts as the hover zone. */
	hoverRatio: number;
	/**
	 * Width (px) the revealed surface occupies; the hover zone expands to
	 * this while visible so the surface doesn't dismiss under the cursor.
	 */
	activeWidth?: number;
	/** Elements matching this selector suppress the edge reveal. */
	ignoreSelector?: string;
}

/**
 * Smart-edges behavior: reveals a hidden edge surface (sidebar/rail) when
 * the cursor lingers near a window edge, and hides it shortly after the
 * cursor leaves. Mirrors the desktop app's hover-show/hide delays.
 */
export function useEdgeHover({
	side,
	enabled,
	hoverRatio,
	activeWidth,
	ignoreSelector,
}: UseEdgeHoverOptions) {
	const [isVisible, setIsVisible] = useState(false);
	const [isHoverPending, setIsHoverPending] = useState(false);
	const isVisibleRef = useRef(false);
	const showTimeoutRef = useRef<number | null>(null);
	const hideTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		const setVisible = (visible: boolean) => {
			isVisibleRef.current = visible;
			setIsVisible(visible);
		};

		const clearHoverTimeouts = () => {
			if (showTimeoutRef.current !== null) {
				window.clearTimeout(showTimeoutRef.current);
				showTimeoutRef.current = null;
			}
			if (hideTimeoutRef.current !== null) {
				window.clearTimeout(hideTimeoutRef.current);
				hideTimeoutRef.current = null;
			}
		};

		const scheduleVisible = (visible: boolean) => {
			if (isVisibleRef.current === visible) {
				setIsHoverPending(false);
				return;
			}

			setIsHoverPending(visible);
			const delay = visible ? HOVER_SHOW_DELAY_MS : HOVER_HIDE_DELAY_MS;
			const targetRef = visible ? showTimeoutRef : hideTimeoutRef;
			const oppositeRef = visible ? hideTimeoutRef : showTimeoutRef;

			if (oppositeRef.current !== null) {
				window.clearTimeout(oppositeRef.current);
				oppositeRef.current = null;
			}

			if (targetRef.current !== null) return;

			targetRef.current = window.setTimeout(() => {
				setVisible(visible);
				setIsHoverPending(false);
				targetRef.current = null;
			}, delay);
		};

		if (!enabled) {
			clearHoverTimeouts();
			setIsHoverPending(false);
			setVisible(false);
			return;
		}

		const handleMouseMove = (event: MouseEvent) => {
			const target = event.target;
			if (
				ignoreSelector &&
				target instanceof Element &&
				target.closest(ignoreSelector)
			) {
				clearHoverTimeouts();
				setIsHoverPending(false);
				setVisible(false);
				return;
			}

			const triggerWidth = window.innerWidth * hoverRatio;
			const zoneWidth =
				isVisibleRef.current && activeWidth
					? Math.max(triggerWidth, activeWidth)
					: triggerWidth;
			const distance =
				side === 'left' ? event.clientX : window.innerWidth - event.clientX;
			scheduleVisible(distance <= zoneWidth);
		};
		const handleMouseLeave = () => {
			clearHoverTimeouts();
			setIsHoverPending(false);
			setVisible(false);
		};
		const handleMouseOut = (event: MouseEvent) => {
			if (!event.relatedTarget) {
				handleMouseLeave();
			}
		};

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseout', handleMouseOut);
		window.addEventListener('blur', handleMouseLeave);
		document.documentElement.addEventListener('mouseleave', handleMouseLeave);
		return () => {
			clearHoverTimeouts();
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseout', handleMouseOut);
			window.removeEventListener('blur', handleMouseLeave);
			document.documentElement.removeEventListener(
				'mouseleave',
				handleMouseLeave,
			);
		};
	}, [enabled, hoverRatio, activeWidth, ignoreSelector, side]);

	return { isVisible, isHoverPending };
}
