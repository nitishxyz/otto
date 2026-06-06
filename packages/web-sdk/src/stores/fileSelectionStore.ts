import { create } from 'zustand';
import type { FileSelectionContext } from '../lib/fileSelectionContext';

export const NEW_SESSION_FILE_SELECTIONS_KEY = '__new-session__';

interface FileSelectionState {
	activeSelection: FileSelectionContext | null;
	pendingSelections: Map<string, FileSelectionContext[]>;
	setActiveSelection: (selection: FileSelectionContext | null) => void;
	clearActiveSelection: () => void;
	attachSelectionToSession: (
		sessionId: string,
		selection: FileSelectionContext,
	) => void;
	removeSelectionFromSession: (sessionId: string, selectionId: string) => void;
	getSelections: (sessionId: string) => FileSelectionContext[];
	clearSelections: (sessionId: string) => void;
	consumeSelections: (sessionId: string) => FileSelectionContext[];
}

export const useFileSelectionStore = create<FileSelectionState>((set, get) => ({
	activeSelection: null,
	pendingSelections: new Map(),

	setActiveSelection: (selection) => set({ activeSelection: selection }),
	clearActiveSelection: () => set({ activeSelection: null }),

	attachSelectionToSession: (sessionId, selection) => {
		set((state) => {
			const next = new Map(state.pendingSelections);
			const existing = next.get(sessionId) ?? [];
			const filtered = existing.filter((item) => item.id !== selection.id);
			next.set(sessionId, [...filtered, selection]);
			return { pendingSelections: next };
		});
	},

	removeSelectionFromSession: (sessionId, selectionId) => {
		set((state) => {
			const next = new Map(state.pendingSelections);
			const existing = next.get(sessionId) ?? [];
			const filtered = existing.filter((item) => item.id !== selectionId);
			if (filtered.length === 0) {
				next.delete(sessionId);
			} else {
				next.set(sessionId, filtered);
			}
			return { pendingSelections: next };
		});
	},

	getSelections: (sessionId) => get().pendingSelections.get(sessionId) ?? [],

	clearSelections: (sessionId) => {
		set((state) => {
			const next = new Map(state.pendingSelections);
			next.delete(sessionId);
			return { pendingSelections: next };
		});
	},

	consumeSelections: (sessionId) => {
		const selections = get().getSelections(sessionId);
		get().clearSelections(sessionId);
		return selections;
	},
}));
