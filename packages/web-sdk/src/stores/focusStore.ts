import { create } from 'zustand';

export type FocusArea =
	| 'input'
	| 'sessions'
	| 'git'
	| 'viewer'
	| 'rightPanel'
	| null;

interface FocusState {
	currentFocus: FocusArea;
	sessionIndex: number;
	gitFileIndex: number;

	setFocus: (area: FocusArea) => void;
	setSessionIndex: (index: number) => void;
	setGitFileIndex: (index: number) => void;
	resetGitFileIndex: () => void;
	resetSessionIndex: () => void;
}

export const useFocusStore = create<FocusState>((set) => ({
	currentFocus: null,
	sessionIndex: 0,
	gitFileIndex: 0,

	setFocus: (area) => set({ currentFocus: area }),
	setSessionIndex: (index) => set({ sessionIndex: index }),
	setGitFileIndex: (index) => set({ gitFileIndex: index }),
	resetGitFileIndex: () => set({ gitFileIndex: 0 }),
	resetSessionIndex: () => set({ sessionIndex: 0 }),
}));
