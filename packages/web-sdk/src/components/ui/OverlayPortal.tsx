import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface OverlayPortalProps {
	children: ReactNode;
}

/**
 * Renders full-screen overlay content into `document.body`.
 *
 * Virtualized thread rows (`@legendapp/list`) set `contain: paint layout style`
 * on every item container, which makes the row a containing block for
 * `position: fixed` descendants and clips their paint. Overlays rendered from
 * inside a row would otherwise be sized to that row instead of the viewport.
 *
 * Renders nothing while there is no DOM (server rendering).
 */
export function OverlayPortal({ children }: OverlayPortalProps) {
	if (typeof document === 'undefined') return null;
	return createPortal(children, document.body);
}
