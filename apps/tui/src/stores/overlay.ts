import { create } from 'zustand';
import type { Overlay } from '../types.ts';

export type StatusIndicator =
	| { type: 'idle' }
	| { type: 'loading'; label: string }
	| { type: 'success'; label: string }
	| { type: 'error'; label: string };

interface OverlayState {
	overlay: Overlay;
	dictationReady: (() => void) | null;
	status: StatusIndicator;
	escHint: boolean;
	_statusTimer: ReturnType<typeof setTimeout> | null;
	_escTimer: ReturnType<typeof setTimeout> | null;
	setOverlay: (overlay: Overlay) => void;
	requestDictationInstall: (onReady: () => void) => void;
	completeDictationInstall: () => void;
	showStatus: (s: StatusIndicator, autoClearMs?: number) => void;
	setEscHint: (hint: boolean) => void;
	clearEscHint: () => void;
	cleanup: () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
	overlay: 'none',
	dictationReady: null,
	status: { type: 'idle' },
	escHint: false,
	_statusTimer: null,
	_escTimer: null,

	setOverlay: (overlay) =>
		set((state) => ({
			overlay,
			dictationReady: overlay === 'dictation' ? state.dictationReady : null,
		})),

	requestDictationInstall: (onReady) =>
		set({ overlay: 'dictation', dictationReady: onReady }),

	completeDictationInstall: () => {
		const onReady = get().dictationReady;
		set({ overlay: 'none', dictationReady: null });
		onReady?.();
	},

	showStatus: (s, autoClearMs) => {
		const prev = get()._statusTimer;
		if (prev) clearTimeout(prev);
		if (autoClearMs) {
			const timer = setTimeout(
				() => set({ status: { type: 'idle' }, _statusTimer: null }),
				autoClearMs,
			);
			set({ status: s, _statusTimer: timer });
		} else {
			set({ status: s, _statusTimer: null });
		}
	},

	setEscHint: (hint) => {
		const prev = get()._escTimer;
		if (prev) clearTimeout(prev);
		if (hint) {
			const timer = setTimeout(
				() => set({ escHint: false, _escTimer: null }),
				3000,
			);
			set({ escHint: hint, _escTimer: timer });
		} else {
			set({ escHint: false, _escTimer: null });
		}
	},

	clearEscHint: () => {
		const prev = get()._escTimer;
		if (prev) clearTimeout(prev);
		set({ escHint: false, _escTimer: null });
	},

	cleanup: () => {
		const { _statusTimer, _escTimer } = get();
		if (_statusTimer) clearTimeout(_statusTimer);
		if (_escTimer) clearTimeout(_escTimer);
	},
}));
