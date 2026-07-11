import { getCurrentWindow } from '@tauri-apps/api/window';

const INTERACTIVE_SELECTOR = [
	'button',
	'a',
	'input',
	'select',
	'textarea',
	'[role="button"]',
	'[role="tab"]',
	'[role="menuitem"]',
	'[contenteditable="true"]',
	'[data-no-drag]',
].join(', ');

/**
 * Reusable native drag handler for desktop title bars and header rows.
 * Starts a window drag on primary-button mousedown unless the press landed
 * on an interactive control, which stays clickable (no-drag).
 */
export const handleTitleBarDrag = (e: React.MouseEvent) => {
	const target = e.target as HTMLElement;
	const isInteractive = target.closest(INTERACTIVE_SELECTOR);
	if (e.buttons === 1 && !isInteractive) {
		getCurrentWindow().startDragging();
	}
};
