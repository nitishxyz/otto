import { create } from 'zustand';

interface SubagentViewerState {
	isOpen: boolean;
	childSessionId: string | null;
	agent: string | null;
	task: string | null;
	open: (args: { childSessionId: string; agent: string; task: string }) => void;
	close: () => void;
}

export const useSubagentViewerStore = create<SubagentViewerState>((set) => ({
	isOpen: false,
	childSessionId: null,
	agent: null,
	task: null,

	open: ({ childSessionId, agent, task }) =>
		set({ isOpen: true, childSessionId, agent, task }),

	close: () =>
		set({ isOpen: false, childSessionId: null, agent: null, task: null }),
}));
