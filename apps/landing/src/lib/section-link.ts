import type { MouseEvent } from 'react';

/** Homepage sections that can be linked to from anywhere on the site. */
export type SectionId = 'install' | 'desktop';

/**
 * Modified and non-primary clicks belong to the browser: intercepting them
 * would break open-in-new-tab and middle-click.
 */
function isPlainClick(event: MouseEvent<HTMLElement>): boolean {
	return (
		!event.defaultPrevented &&
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	);
}

/**
 * Builds a click handler that smooth-scrolls to a homepage section.
 *
 * Works for both `<a href="#id">` and `<button>` callers: anchors keep their
 * href so they stay real links, and callers on other pages fall back to a
 * normal navigation to `/#<id>`.
 */
export function sectionLink(id: SectionId) {
	return (event: MouseEvent<HTMLElement>) => {
		if (!isPlainClick(event)) return;
		event.preventDefault();

		// Read the path at click time so callers do not have to thread it in.
		if (window.location.pathname !== '/') {
			window.location.href = `/#${id}`;
			return;
		}

		const target = document.getElementById(id);
		if (!target) return;

		target.scrollIntoView({
			behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
				? 'auto'
				: 'smooth',
			block: 'start',
		});
		// `preventDefault()` drops the anchor's history entry; restore it so the
		// URL stays shareable and Back still leaves the section.
		window.history.pushState(null, '', `#${id}`);
	};
}
