import { useEffect, useState } from 'react';

const SHORTCUT_HINT_MODIFIERS = new Set(['Control', 'Meta']);

/**
 * Returns true while the shortcut modifier key is held down.
 */
export function useShortcutHintsVisible() {
	const [isVisible, setIsVisible] = useState(false);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				SHORTCUT_HINT_MODIFIERS.has(event.key) ||
				event.ctrlKey ||
				event.metaKey
			) {
				setIsVisible(true);
			}
		};

		const handleKeyUp = (event: KeyboardEvent) => {
			if (
				SHORTCUT_HINT_MODIFIERS.has(event.key) ||
				(!event.ctrlKey && !event.metaKey)
			) {
				setIsVisible(false);
			}
		};

		const handleBlur = () => setIsVisible(false);

		window.addEventListener('keydown', handleKeyDown, true);
		window.addEventListener('keyup', handleKeyUp, true);
		window.addEventListener('blur', handleBlur);

		return () => {
			window.removeEventListener('keydown', handleKeyDown, true);
			window.removeEventListener('keyup', handleKeyUp, true);
			window.removeEventListener('blur', handleBlur);
		};
	}, []);

	return isVisible;
}
