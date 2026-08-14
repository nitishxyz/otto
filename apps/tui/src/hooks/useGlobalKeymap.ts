import { useKeyboard } from '@opentui/react';
import type { Overlay } from '../types.ts';

interface GlobalKeymapOptions {
	overlay: Overlay;
	isStreaming: boolean;
	hasActiveSession: boolean;
	hasSecureInput: boolean;
	isWorkspaceFocused: boolean;
	escHint: boolean;
	setEscHint: (value: boolean) => void;
	clearEscHint: () => void;
	setOverlay: (overlay: Overlay) => void;
	createSession: () => void;
	openSessions: () => void;
	retryLastFailedMessage: () => void;
	abortActiveSession: () => void;
	toggleWorkspace: () => void;
	focusWorkspace: () => void;
	moveWorkspaceFocus: (direction: 'left' | 'right') => void;
	backWorkspace: () => void;
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
	isWorkspaceFocused,
	escHint,
	setEscHint,
	clearEscHint,
	setOverlay,
	createSession,
	openSessions,
	retryLastFailedMessage,
	abortActiveSession,
	toggleWorkspace,
	focusWorkspace,
	moveWorkspaceFocus,
	backWorkspace,
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
			if (isWorkspaceFocused) {
				backWorkspace();
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
		if (key.ctrl && key.name === 'r' && overlay === 'none') {
			key.preventDefault();
			key.stopPropagation();
			retryLastFailedMessage();
			return;
		}
		if (key.ctrl && key.name === 'b' && overlay === 'none') {
			toggleWorkspace();
			return;
		}
		if (key.name === 'f6' && overlay === 'none') {
			focusWorkspace();
			return;
		}
		if (
			key.ctrl &&
			(key.name === 'h' || key.name === 'l') &&
			overlay === 'none'
		) {
			key.preventDefault();
			key.stopPropagation();
			moveWorkspaceFocus(key.name === 'h' ? 'left' : 'right');
			return;
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
