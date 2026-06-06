import { create } from 'zustand';
import type { FileSelectionContext } from '../lib/fileSelectionContext';

export interface BtwAnchorRect {
	top: number;
	left: number;
	bottom: number;
	right: number;
}

interface BtwPanelState {
	isOpen: boolean;
	selection: FileSelectionContext | null;
	parentSessionId: string | null;
	sessionId: string | null;
	anchorRect: BtwAnchorRect | null;
	open: (args: {
		selection: FileSelectionContext;
		parentSessionId?: string | null;
		anchorRect?: BtwAnchorRect | null;
	}) => void;
	setSessionId: (sessionId: string) => void;
	close: () => void;
}

export const useBtwStore = create<BtwPanelState>((set) => ({
	isOpen: false,
	selection: null,
	parentSessionId: null,
	sessionId: null,
	anchorRect: null,

	open: ({ selection, parentSessionId = null, anchorRect = null }) =>
		set({
			isOpen: true,
			selection,
			parentSessionId,
			sessionId: null,
			anchorRect,
		}),

	setSessionId: (sessionId) => set({ sessionId }),

	close: () =>
		set({
			isOpen: false,
			selection: null,
			parentSessionId: null,
			sessionId: null,
			anchorRect: null,
		}),
}));
