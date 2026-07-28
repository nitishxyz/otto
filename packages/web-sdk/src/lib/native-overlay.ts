const NATIVE_OVERLAY_SELECTOR =
	'[data-native-overlay-root="true"], [aria-modal="true"]';

const listeners = new Set<(isOpen: boolean) => void>();
let observer: MutationObserver | null = null;
let isOpen = false;

function readNativeOverlayState(): boolean {
	return (
		typeof document !== 'undefined' &&
		document.querySelector(NATIVE_OVERLAY_SELECTOR) !== null
	);
}

function publishNativeOverlayState(): void {
	const nextIsOpen = readNativeOverlayState();
	if (nextIsOpen === isOpen) return;
	isOpen = nextIsOpen;
	for (const listener of listeners) listener(isOpen);
}

function ensureObserver(): void {
	if (observer || typeof document === 'undefined') return;
	isOpen = readNativeOverlayState();
	observer = new MutationObserver(publishNativeOverlayState);
	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['aria-modal', 'data-native-overlay-root'],
	});
}

/** Watches app overlays that must cover native child webviews. */
export function subscribeNativeOverlay(
	listener: (isOpen: boolean) => void,
): () => void {
	listeners.add(listener);
	ensureObserver();
	listener(isOpen);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && observer) {
			observer.disconnect();
			observer = null;
			isOpen = false;
		}
	};
}
