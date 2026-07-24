import { useKeyboard } from '@opentui/react';
import type { Overlay } from '../types.ts';

interface GlobalKeymapOptions {
	overlay: Overlay;
	isStreaming: boolean;
	hasActiveSession: boolean;
	hasSecureInput: boolean;
	escHint: boolean;
	setEscHint: (value: boolean) => void;
	clearEscHint: () => void;
	setOverlay: (overlay: Overlay) => void;
	createSession: () => void;
	openSessions: () => void;
	abortActiveSession: () => void;
	onQuit: () => void;
}

/**
 * App-level keyboard shortcuts. Overlay- and input-specific handling lives
 * with those components; this only covers global chords and escape logic.
 */
export function useGlobalKeymap({
	overlay,
	isStreaming,
	hasActiveSession,
	hasSecureInput,
	escHint,
	setEscHint,
	clearEscHint,
	setOverlay,
	createSession,
	openSessions,
	abortActiveSession,
	onQuit,
}: GlobalKeymapOptions) {
	useKeyboard((key) => {
		if (hasSecureInput && !(key.ctrl && key.name === 'c')) {
			return;
		}
		if (key.name === 'escape') {
			if (overlay !== 'none') {
				setOverlay('none');
				return;
			}
			if (isStreaming && hasActiveSession) {
				if (escHint) {
					abortActiveSession();
					clearEscHint();
				} else {
					setEscHint(true);
				}
				return;
			}
		}
		if (key.ctrl && key.name === 'n') {
			createSession();
			return;
		}
		if (key.ctrl && key.name === 's') {
			openSessions();
			return;
		}
		if (key.ctrl && key.name === 'p') {
			setOverlay('models');
			return;
		}
		if (key.ctrl && key.name === 't') {
			setOverlay('theme');
			return;
		}
		if (key.ctrl && key.name === 'm') {
			setOverlay('mcp');
			return;
		}
		if (key.ctrl && key.name === 'c') {
			if (isStreaming && hasActiveSession) {
				abortActiveSession();
				clearEscHint();
			} else {
				onQuit();
			}
		}
	});
}
